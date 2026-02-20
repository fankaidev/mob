/**
 * ChatSession Durable Object
 *
 * Each chat session is represented by a unique Durable Object instance.
 * - Provides strong consistency for real-time chat
 * - Uses D1 for persistent storage
 * - Manages conversation history and streaming responses
 * - Supports git repository mounting for code browsing
 */

import type { DurableObjectState } from '@cloudflare/workers-types'
import { D1FileSystem, MountableFs } from '../lib/fs'
import { restoreMounts } from '../lib/fs/mount-store'
import { Agent } from '../lib/pi-agent'
import type { AgentMessage } from '../lib/pi-agent/types'
import type { Model } from '../lib/pi-ai/types'
import { createBashInstance, createBashTool } from '../lib/tools/bash'
import { createEditTool, createListTool, createReadTool, createWriteTool } from '../lib/tools/file-tools'
import { createListMountsTool, createMountTool, createUnmountTool } from '../lib/tools/mount-tools'
import { createWebFetchTool } from '../lib/tools/web-fetch'
import SYSTEM_PROMPT from '../SYSTEM_PROMPT.md'

interface Env {
  DB: D1Database
}

export class ChatSession {
  private state: DurableObjectState
  private env: Env
  private sessionId: string
  private messages: AgentMessage[] = []
  private initialized = false
  private mountableFs: MountableFs | null = null

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    // Session ID will be set from X-Session-Id header on first request
    // This is a workaround for CF Workers bug: state.id.name is not available
    // See: https://github.com/cloudflare/workerd/issues/2240
    this.sessionId = ''
  }

  /**
   * Initialize session from D1 database (lightweight - just load messages)
   */
  private async initialize() {
    if (this.initialized) return
    const startTime = Date.now()

    // Check if session exists in D1
    const session = await this.env.DB.prepare(
      'SELECT * FROM sessions WHERE id = ?'
    ).bind(this.sessionId).first()
    console.log(`[Perf] Session query: ${Date.now() - startTime}ms`)

    if (!session) {
      // Create new session
      const now = Date.now()
      await this.env.DB.prepare(
        'INSERT INTO sessions (id, created_at, updated_at, status) VALUES (?, ?, ?, ?)'
      ).bind(this.sessionId, now, now, 'active').run()

      this.messages = []
    } else {
      // Load existing messages (prefix is included in the JSON content)
      const msgStart = Date.now()
      const result = await this.env.DB.prepare(
        'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC'
      ).bind(this.sessionId).all()
      console.log(`[Perf] Messages query: ${Date.now() - msgStart}ms, count: ${result.results.length}`)

      this.messages = result.results.map((row: any) => JSON.parse(row.content))
    }

    this.initialized = true
    console.log(`[Perf] Total initialize: ${Date.now() - startTime}ms`)
  }

  /**
   * Initialize filesystem (lazy - only when needed for chat)
   */
  private async initializeFilesystem() {
    if (this.mountableFs) return
    const startTime = Date.now()

    // Initialize MountableFs with D1FileSystem base for persistent storage
    const baseFs = new D1FileSystem(this.env.DB, this.sessionId)

    // Ensure the __shared__ session exists for shared files under /work
    const SHARED_SESSION_ID = '__shared__'
    const sharedSession = await this.env.DB.prepare(
      'SELECT id FROM sessions WHERE id = ?'
    ).bind(SHARED_SESSION_ID).first()

    if (!sharedSession) {
      const now = Date.now()
      await this.env.DB.prepare(
        'INSERT INTO sessions (id, created_at, updated_at, status) VALUES (?, ?, ?, ?)'
      ).bind(SHARED_SESSION_ID, now, now, 'active').run()
    }

    const dirStart = Date.now()
    await baseFs.initializeDefaultDirectories()
    console.log(`[Perf] Initialize directories: ${Date.now() - dirStart}ms`)

    this.mountableFs = new MountableFs({ base: baseFs })

    // Create /mnt directory for git mounts
    try {
      await this.mountableFs.mkdir('/mnt', { recursive: true })
    } catch {
      // Ignore if already exists
    }

    // Restore persisted mounts
    const mountStart = Date.now()
    await restoreMounts(this.env.DB, this.sessionId, this.mountableFs)
    console.log(`[Perf] Restore mounts: ${Date.now() - mountStart}ms`)

    console.log(`[Perf] Total filesystem init: ${Date.now() - startTime}ms`)
  }

  /**
   * Save a message to D1
   */
  private async saveMessage(message: AgentMessage) {
    const now = Date.now()
    await this.env.DB.prepare(
      'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)'
    ).bind(
      this.sessionId,
      message.role,
      JSON.stringify(message),
      now
    ).run()

    // Update session timestamp
    await this.env.DB.prepare(
      'UPDATE sessions SET updated_at = ? WHERE id = ?'
    ).bind(now, this.sessionId).run()
  }

  /**
   * Build model config
   */
  private buildModel(baseUrl: string, modelId: string, provider: string): Model<'anthropic-messages'> {
    return {
      id: modelId,
      name: modelId,
      api: 'anthropic-messages',
      provider: provider as any,
      baseUrl,
      reasoning: false,
      input: ['text', 'image'],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200000,
      maxTokens: 8192,
    }
  }

  /**
   * Handle incoming HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    // Extract session ID from X-Session-Id header
    // Workaround for CF Workers bug: state.id.name is not available
    // See: https://github.com/cloudflare/workerd/issues/2240
    const sessionIdFromHeader = request.headers.get('X-Session-Id')
    if (!sessionIdFromHeader) {
      return new Response(JSON.stringify({ error: 'X-Session-Id header is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Set session ID if not already set, or verify it matches
    if (!this.sessionId) {
      this.sessionId = sessionIdFromHeader
    } else if (this.sessionId !== sessionIdFromHeader) {
      // Fail fast: session ID mismatch
      throw new Error(`Session ID mismatch! DO has: ${this.sessionId}, Request has: ${sessionIdFromHeader}`)
    }

    await this.initialize()

    const url = new URL(request.url)

    // GET /history - Get conversation history
    if (request.method === 'GET' && url.pathname === '/history') {
      return new Response(JSON.stringify({
        sessionId: this.sessionId,
        messages: this.messages,
      }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // POST /chat - Send message and get streaming response
    if (request.method === 'POST' && url.pathname === '/chat') {
      const { message, llmConfigName, contextMessages, systemPrompt, assistantPrefix } = await request.json() as {
        message: AgentMessage  // Only accept AgentMessage format
        llmConfigName: string  // LLM config name (query from database)
        contextMessages?: AgentMessage[]
        systemPrompt?: string
        assistantPrefix?: string  // Optional prefix for assistant messages (e.g., "bot:AppName")
      }

      // Query LLM config from database
      const llmConfig = await this.env.DB.prepare(
        'SELECT * FROM llm_configs WHERE name = ?'
      ).bind(llmConfigName).first() as any

      if (!llmConfig) {
        return new Response(JSON.stringify({ error: `LLM config not found: ${llmConfigName}` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      const { base_url: baseUrl, api_key: apiKey, model, provider } = llmConfig

      // Extract text from message for validation and bash command check
      const messageText = typeof message.content === 'string'
        ? message.content
        : (message.content?.[0] && typeof message.content[0] !== 'string' && message.content[0].type === 'text'
            ? message.content[0].text
            : '')

      // Validate message
      if (!messageText.trim()) {
        return new Response(JSON.stringify({ error: 'Message is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Check if message starts with '!' - direct bash execution
      const trimmedMessage = messageText.trim()
      if (trimmedMessage.startsWith('!')) {
        const command = trimmedMessage.slice(1).trim()
        if (!command) {
          return new Response(JSON.stringify({ error: 'Command is required after !' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        // Create SSE stream for bash output
        const { readable, writable } = new TransformStream()
        const writer = writable.getWriter()
        const encoder = new TextEncoder()

        // Handle bash execution in background
        this.handleBashCommand(command, writer, encoder).catch((error) => {
          console.error('Bash error:', error)
          writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`))
          writer.close()
        })

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        })
      }

      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'API key is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      if (!model) {
        return new Response(JSON.stringify({ error: 'Model is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      if (!provider) {
        return new Response(JSON.stringify({ error: 'Provider is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Create SSE stream
      const { readable, writable } = new TransformStream()
      const writer = writable.getWriter()
      const encoder = new TextEncoder()

      // Handle chat in background
      this.handleChat(message, baseUrl, apiKey, model, provider, writer, encoder, contextMessages, systemPrompt, assistantPrefix).catch((error) => {
        console.error('Chat error:', error)
        writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`))
        writer.close()
      })

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    }

    return new Response('Not found', { status: 404 })
  }

  /**
   * Default system prompt
   */
  private getDefaultSystemPrompt(): string {
    return SYSTEM_PROMPT
  }

  /**
   * Handle direct bash command execution (for messages starting with '!')
   */
  private async handleBashCommand(
    command: string,
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder
  ) {
    try {
      // Initialize filesystem for bash commands
      await this.initializeFilesystem()

      // Send session ID
      await writer.write(encoder.encode(
        `data: ${JSON.stringify({ type: 'session_id', sessionId: this.sessionId })}\n\n`
      ))

      // Create bash instance
      const bash = await createBashInstance({
        sessionId: this.sessionId,
        db: this.env.DB,
        fs: this.mountableFs!,
      })

      // Execute command
      const result = await bash.exec(command)
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n') || '(no output)'

      // Format output as code block
      const formattedOutput = '```\n' + output + '\n```'

      // Stream the output
      await writer.write(encoder.encode(
        `data: ${JSON.stringify({ type: 'text', text: formattedOutput })}\n\n`
      ))

      // Create user message for the command
      const userMessage: AgentMessage = {
        role: 'user',
        content: [{ type: 'text', text: `! ${command}` }],
        timestamp: Date.now()
      }

      // Create assistant message for the result (using type assertion since these are simple bash outputs)
      const assistantMessage = {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: formattedOutput }],
        timestamp: Date.now()
      } as AgentMessage

      // Add to messages
      this.messages.push(userMessage, assistantMessage)

      // Save to D1
      await this.env.DB.batch([
        this.env.DB.prepare('DELETE FROM messages WHERE session_id = ?').bind(this.sessionId),
        ...this.messages.map(msg =>
          this.env.DB.prepare(
            'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)'
          ).bind(this.sessionId, msg.role, JSON.stringify(msg), Date.now())
        ),
        this.env.DB.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
          .bind(Date.now(), this.sessionId),
      ])

      // Send done signal
      await writer.write(encoder.encode('data: [DONE]\n\n'))
      await writer.close()

    } catch (error) {
      console.error('Bash error:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      await writer.write(encoder.encode(
        `data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`
      ))
      await writer.close()
    }
  }

  /**
   * Add prefix to message text (temporary, for LLM context only)
   * Does not modify the original message object
   */
  private addPrefixToMessages(messages: AgentMessage[]): AgentMessage[] {
    return messages.map(msg => {
      if (!msg.prefix) return msg

      const cloned = JSON.parse(JSON.stringify(msg))
      if (cloned.content?.[0]?.type === 'text') {
        cloned.content[0].text = `[${msg.prefix}] ${cloned.content[0].text}`
      }
      return cloned
    })
  }

  /**
   * Handle chat message with streaming
   * @param contextMessages - Optional messages from external context (e.g., Slack thread history)
   * @param systemPrompt - Optional custom system prompt
   * @param assistantPrefix - Optional prefix for new assistant messages (e.g., "bot:AppName")
   */
  private async handleChat(
    message: AgentMessage,  // Only accept AgentMessage format
    baseUrl: string,
    apiKey: string,
    model: string,
    provider: string,
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder,
    contextMessages?: AgentMessage[],
    systemPrompt?: string,
    assistantPrefix?: string
  ) {
    try {
      // Initialize filesystem for chat (with tools)
      await this.initializeFilesystem()

      // Send session ID
      await writer.write(encoder.encode(
        `data: ${JSON.stringify({ type: 'session_id', sessionId: this.sessionId })}\n\n`
      ))

      // Create agent with existing messages
      const modelConfig = this.buildModel(baseUrl, model, provider)

      // Create shared bash instance for all tools
      const bash = await createBashInstance({
        sessionId: this.sessionId,
        db: this.env.DB,
        fs: this.mountableFs!,
      })

      // Create file operation tools
      const bashTool = createBashTool(bash)
      const readTool = createReadTool(bash)
      const writeTool = createWriteTool(bash)
      const editTool = createEditTool(bash)
      const listTool = createListTool(bash)

      // Create mount tools with shared MountableFs
      const mountToolOptions = {
        sessionId: this.sessionId,
        db: this.env.DB,
        mountableFs: this.mountableFs!,
      }
      const mountTool = createMountTool(mountToolOptions)
      const unmountTool = createUnmountTool(mountToolOptions)
      const listMountsTool = createListMountsTool(mountToolOptions)

      // Create web fetch tool
      const webFetchTool = createWebFetchTool()

      // Determine which messages to use:
      // - If contextMessages provided (e.g., from Slack thread), use those
      // - Otherwise use stored session messages
      const initialMessages = contextMessages && contextMessages.length > 0
        ? contextMessages
        : this.messages

      // Build final system prompt: default + optional custom prompt appended
      const defaultPrompt = this.getDefaultSystemPrompt()
      const finalSystemPrompt = systemPrompt
        ? `${defaultPrompt}\n\n---\n\n${systemPrompt}`
        : defaultPrompt

      const agent = new Agent({
        initialState: {
          model: modelConfig,
          systemPrompt: finalSystemPrompt,
          tools: [readTool, writeTool, editTool, listTool, bashTool, mountTool, unmountTool, listMountsTool, webFetchTool],
          messages: initialMessages,  // Store clean messages without prefix
        },
        // Add prefix only when converting to LLM format (temporary, not stored in agent state)
        convertToLlm: async (messages) => {
          return this.addPrefixToMessages(messages)
        },
        getApiKey: async () => apiKey,
      })

      // Track previous text length to send only deltas
      let previousTextLength = 0
      let eventCount = 0

      // Subscribe to agent events for streaming
      agent.subscribe(async (event) => {
        eventCount++

        // Send tool execution events
        if (event.type === 'tool_execution_start') {
          await writer.write(encoder.encode(
            `data: ${JSON.stringify({
              type: 'tool_call_start',
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              args: event.args
            })}\n\n`
          ))
        }

        if (event.type === 'tool_execution_end') {
          await writer.write(encoder.encode(
            `data: ${JSON.stringify({
              type: 'tool_call_end',
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              isError: event.isError
            })}\n\n`
          ))
        }

        // Extract text from message updates
        if (event.type === 'message_update' && event.message.role === 'assistant') {
          const content = event.message.content
          if (Array.isArray(content)) {
            const textParts = content
              .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
              .map(c => c.text)

            if (textParts.length > 0) {
              const fullText = textParts.join('')
              // Send only the new delta
              const deltaText = fullText.slice(previousTextLength)
              if (deltaText) {
                await writer.write(encoder.encode(
                  `data: ${JSON.stringify({ type: 'text', text: deltaText })}\n\n`
                ))
                previousTextLength = fullText.length
              }
            }
          }
        }
      })

      // Run agent with AgentMessage
      await agent.prompt(message)

      // Update in-memory messages and add prefix to new assistant messages
      this.messages = agent.state.messages.map((msg) => {
        const cloned = JSON.parse(JSON.stringify(msg))
        // Add assistantPrefix to assistant messages that don't have a prefix yet
        if (assistantPrefix && msg.role === 'assistant' && !cloned.prefix) {
          cloned.prefix = assistantPrefix
        }
        return cloned
      })

      // Save new messages to D1 (only new ones after the prompt)
      // Note: We save all messages to keep it simple
      // In production, you'd want to only save the delta
      await this.env.DB.batch([
        // Clear old messages
        this.env.DB.prepare('DELETE FROM messages WHERE session_id = ?').bind(this.sessionId),
        // Insert all current messages (prefix is included in the JSON content)
        ...this.messages.map(msg =>
          this.env.DB.prepare(
            'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)'
          ).bind(this.sessionId, msg.role, JSON.stringify(msg), Date.now())
        ),
        // Update session timestamp
        this.env.DB.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
          .bind(Date.now(), this.sessionId),
      ])

      // Send done signal
      await writer.write(encoder.encode('data: [DONE]\n\n'))
      await writer.close()

    } catch (error) {
      console.error('Chat error:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      await writer.write(encoder.encode(
        `data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`
      ))
      await writer.close()
    }
  }
}
