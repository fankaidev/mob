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
    this.sessionId = state.id.toString()
  }

  /**
   * Initialize session from D1 database
   */
  private async initialize() {
    if (this.initialized) return

    // Check if session exists in D1
    const session = await this.env.DB.prepare(
      'SELECT * FROM sessions WHERE id = ?'
    ).bind(this.sessionId).first()

    if (!session) {
      // Create new session
      const now = Date.now()
      await this.env.DB.prepare(
        'INSERT INTO sessions (id, created_at, updated_at, status) VALUES (?, ?, ?, ?)'
      ).bind(this.sessionId, now, now, 'active').run()

      this.messages = []
    } else {
      // Load existing messages
      const result = await this.env.DB.prepare(
        'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC'
      ).bind(this.sessionId).all()

      this.messages = result.results.map((row: any) => JSON.parse(row.content))
    }

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

    await baseFs.initializeDefaultDirectories()
    this.mountableFs = new MountableFs({ base: baseFs })

    // Create /mnt directory for git mounts
    try {
      await this.mountableFs.mkdir('/mnt', { recursive: true })
    } catch {
      // Ignore if already exists
    }

    // Restore persisted mounts
    await restoreMounts(this.env.DB, this.sessionId, this.mountableFs)

    this.initialized = true
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
      const { message, baseUrl, apiKey, model, provider, contextMessages, systemPrompt } = await request.json() as {
        message: string
        baseUrl: string
        apiKey: string
        model: string
        provider: string
        contextMessages?: AgentMessage[]
        systemPrompt?: string
      }

      if (!message?.trim()) {
        return new Response(JSON.stringify({ error: 'Message is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Check if message starts with '!' - direct bash execution
      const trimmedMessage = message.trim()
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
      this.handleChat(message, baseUrl, apiKey, model, provider, writer, encoder, contextMessages, systemPrompt).catch((error) => {
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
      }

      // Create assistant message for the result
      const assistantMessage: AgentMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: formattedOutput }],
      }

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
   * Handle chat message with streaming
   * @param contextMessages - Optional messages from external context (e.g., Slack thread history)
   * @param systemPrompt - Optional custom system prompt
   */
  private async handleChat(
    message: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    provider: string,
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder,
    contextMessages?: AgentMessage[],
    systemPrompt?: string
  ) {
    try {
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
          messages: initialMessages,
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

      // Run agent
      await agent.prompt(message)

      // Update in-memory messages
      this.messages = agent.state.messages.map((msg) =>
        JSON.parse(JSON.stringify(msg))
      )

      // Save new messages to D1 (only new ones after the prompt)
      // Note: We save all messages to keep it simple
      // In production, you'd want to only save the delta
      await this.env.DB.batch([
        // Clear old messages
        this.env.DB.prepare('DELETE FROM messages WHERE session_id = ?').bind(this.sessionId),
        // Insert all current messages
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
