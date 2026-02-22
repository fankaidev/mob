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
  private processingQueue: Promise<void> = Promise.resolve()  // Queue for serial processing

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
    // console.log(`[Perf] Initialize directories: ${Date.now() - dirStart}ms`)

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
    // console.log(`[Perf] Restore mounts: ${Date.now() - mountStart}ms`)

    console.log(`[Perf] Total filesystem init: ${Date.now() - startTime}ms`)
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
   * Create all tools for the agent
   */
  private async createTools() {
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

    return [readTool, writeTool, editTool, listTool, bashTool, mountTool, unmountTool, listMountsTool, webFetchTool]
  }

  /**
   * Create event handler for agent streaming events
   */
  private createAgentEventHandler(
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder
  ) {
    let previousTextLength = 0

    return async (event: any) => {
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
            let fullText = textParts.join('')

            // Remove any [bot:xxx] or [user:xxx] prefix from the beginning
            // This handles cases where LLM mistakenly includes the prefix in its response
            fullText = fullText.replace(/^\s*\[(bot|user):[^\]]+\]\s*/, '')

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
    }
  }

  /**
   * Process new messages after agent execution
   * - Add assistant prefix to new assistant messages
   * - Remove any mistakenly included prefixes from LLM response
   */
  private processNewMessages(
    allMessages: AgentMessage[],
    oldMessageCount: number,
    assistantPrefix?: string
  ): AgentMessage[] {
    return allMessages.slice(oldMessageCount).map((msg) => {
      const cloned = JSON.parse(JSON.stringify(msg))

      // Add assistantPrefix to assistant messages that don't have a prefix yet
      if (assistantPrefix && msg.role === 'assistant' && !cloned.prefix) {
        cloned.prefix = assistantPrefix
      }

      // Remove any [bot:xxx] or [user:xxx] prefix from the beginning of text content
      // This handles cases where LLM mistakenly includes the prefix in its response
      if (cloned.content?.[0]?.type === 'text' && typeof cloned.content[0].text === 'string') {
        cloned.content[0].text = cloned.content[0].text.replace(/^\s*\[(bot|user):[^\]]+\]\s*/, '')
      }

      return cloned
    })
  }

  /**
   * Save messages to D1 database
   */
  private async saveMessagesToDb(messagesToSave: AgentMessage[]) {
    await this.env.DB.batch([
      // Insert messages (prefix is included in the JSON content)
      ...messagesToSave.map(msg =>
        this.env.DB.prepare(
          'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)'
        ).bind(this.sessionId, msg.role, JSON.stringify(msg), Date.now())
      ),
      // Update session timestamp
      this.env.DB.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
        .bind(Date.now(), this.sessionId),
    ])
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

    // POST /slack-event - Handle Slack event (fire-and-forget from Worker)
    if (request.method === 'POST' && url.pathname === '/slack-event') {
      const payload = await request.json() as any

      // Queue the event for serial processing to prevent race conditions
      this.processingQueue = this.processingQueue
        .then(() => this.handleSlackEvent(payload))
        .catch(error => {
          console.error('[DO] Slack event handling error:', error)
        })

      // Return immediately
      return new Response(JSON.stringify({ ok: true }), {
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
    message: AgentMessage,
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

      // If contextMessages provided, save them to DB and update in-memory state first
      if (contextMessages && contextMessages.length > 0) {
        await this.saveMessagesToDb(contextMessages)
        this.messages = [...this.messages, ...contextMessages]
      }

      // Create agent with existing messages
      const modelConfig = this.buildModel(baseUrl, model, provider)
      const tools = await this.createTools()

      // Track the number of messages before agent.prompt() to identify new messages
      const oldMessageCount = this.messages.length

      // Build final system prompt
      const defaultPrompt = this.getDefaultSystemPrompt()
      const finalSystemPrompt = systemPrompt
        ? `${defaultPrompt}\n\n---\n\n${systemPrompt}`
        : defaultPrompt

      // Create and configure agent
      const agent = new Agent({
        initialState: {
          model: modelConfig,
          systemPrompt: finalSystemPrompt,
          tools,
          messages: this.messages,
        },
        convertToLlm: async (messages) => this.addPrefixToMessages(messages),
        getApiKey: async () => apiKey,
      })

      // Subscribe to agent events for streaming
      agent.subscribe(this.createAgentEventHandler(writer, encoder))

      // Run agent with message
      await agent.prompt(message)

      // Process new messages
      const newMessages = this.processNewMessages(
        agent.state.messages,
        oldMessageCount,
        assistantPrefix
      )

      // Update in-memory messages
      this.messages = [...this.messages, ...newMessages]

      // Save only new messages to database
      await this.saveMessagesToDb(newMessages)

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

  /**
   * Handle Slack event (called from Worker via fire-and-forget)
   * Processes the entire Slack message flow including API calls
   */
  private async handleSlackEvent(payload: any) {
    const { appConfig, event, threadKey } = payload

    // Dynamic import to avoid bundling Slack client in main bundle
    const { SlackClient, extractUserMessage, resolveUserMentionsInMessages, convertSlackUserMessagesToAgentMessages, truncateForSlack } = await import('../lib/slack')

    const client = new SlackClient(appConfig.bot_token)
    const channel = event.channel!
    const threadTs = event.thread_ts || event.ts!

    console.log('[DO] handleSlackEvent', event)

    try {
      // Get or fetch bot user ID
      const botUserId = await this.ensureBotUserId(client, appConfig)

      // Validate LLM config exists
      const llmConfig = await this.env.DB.prepare(
        'SELECT * FROM llm_configs WHERE name = ?'
      ).bind(appConfig.llm_config_name).first() as any

      if (!llmConfig) {
        await client.postMessage(
          channel,
          `Error: LLM config "${appConfig.llm_config_name}" not found`,
          threadTs
        )
        return
      }

      // Extract and validate user message
      const userMessage = await extractUserMessage(
        event.text || '',
        botUserId || undefined,
        this.env.DB,
        client,
        appConfig.app_id,
        (_db, client, appId, userId) => this.getUserInfo(client, appId, userId)
      )

      if (!userMessage && !event.thread_ts) {
        await client.postMessage(
          channel,
          'Please include a message after mentioning me!',
          threadTs
        )
        return
      }

      // Construct current user message with prefix
      const currentUserMessage: any = {
        role: 'user',
        content: [{ type: 'text', text: userMessage }],
        timestamp: Date.now()
      }

      if (event.user) {
        const userName = await this.getUserInfo(client, appConfig.app_id, event.user)
        currentUserMessage.prefix = `user:${userName}`
      }

      // Get thread context (history and new messages)
      const { contextMessages, hasError, errorMessage } = await this.getThreadContext(
        client,
        appConfig,
        event,
        botUserId
      )

      if (hasError) {
        await client.postMessage(channel, errorMessage!, threadTs)
        return
      }

      // Send "processing" message first
      const processingMsg = await client.postMessage(channel, 'Processing...', threadTs)
      if (!processingMsg.ok || !processingMsg.ts) {
        const errorMsg = `Failed to send message: ${(processingMsg as any).error || 'unknown error'}`
        console.error('[DO] Slack postMessage failed:', JSON.stringify(processingMsg))
        await client.postMessage(channel, `Error: ${errorMsg}`, threadTs)
        return
      }
      const processingTs = processingMsg.ts

      try {
        const { base_url: baseUrl, api_key: apiKey, model, provider } = llmConfig

        // Initialize filesystem for chat
        await this.initializeFilesystem()

        // If contextMessages provided, save them to DB and update in-memory state first
        if (contextMessages && contextMessages.length > 0) {
          await this.saveMessagesToDb(contextMessages)
          this.messages = [...this.messages, ...contextMessages]
        }

        // Create agent with existing messages
        const modelConfig = this.buildModel(baseUrl, model, provider)
        const tools = await this.createTools()

        // Track the number of messages before agent.prompt() to identify new messages
        const oldMessageCount = this.messages.length

        // Build final system prompt
        const defaultPrompt = this.getDefaultSystemPrompt()
        const finalSystemPrompt = appConfig.system_prompt
          ? `${defaultPrompt}\n\n---\n\n${appConfig.system_prompt}`
          : defaultPrompt

        // Create and configure agent
        const Agent = (await import('../lib/pi-agent')).Agent
        const agent = new Agent({
          initialState: {
            model: modelConfig,
            systemPrompt: finalSystemPrompt,
            tools,
            messages: this.messages,
          },
          convertToLlm: async (messages) => this.addPrefixToMessages(messages),
          getApiKey: async () => apiKey,
        })

        // Collect response text for Slack
        let fullResponse = ''
        agent.subscribe(async (event: any) => {
          if (event.type === 'message_update' && event.message.role === 'assistant') {
            const content = event.message.content
            if (Array.isArray(content)) {
              const textParts = content
                .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                .map(c => c.text)

              if (textParts.length > 0) {
                fullResponse = textParts.join('')
                // Remove any [bot:xxx] or [user:xxx] prefix from the beginning
                fullResponse = fullResponse.replace(/^\s*\[(bot|user):[^\]]+\]\s*/, '')
              }
            }
          }
        })

        // Run agent with message
        await agent.prompt(currentUserMessage)

        // Process new messages
        const assistantPrefix = `bot:${appConfig.app_name}`
        const newMessages = this.processNewMessages(
          agent.state.messages,
          oldMessageCount,
          assistantPrefix
        )

        // Update in-memory messages
        this.messages = [...this.messages, ...newMessages]

        // Save only new messages to database
        await this.saveMessagesToDb(newMessages)

        // Save thread mapping
        await this.env.DB.prepare(`
          INSERT INTO slack_thread_mapping (thread_key, session_id, app_id, channel, thread_ts, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(thread_key) DO UPDATE SET
            session_id = excluded.session_id,
            updated_at = excluded.updated_at
        `).bind(
          threadKey,
          this.sessionId,
          appConfig.app_id,
          channel,
          event.thread_ts || null,
          Date.now(),
          Date.now()
        ).run()

        // Update the processing message with actual response
        if (fullResponse) {
          await client.updateMessage(channel, processingTs, truncateForSlack(fullResponse))
        } else {
          await client.updateMessage(channel, processingTs, 'No response generated.')
        }
      } catch (error) {
        // If processing fails, update the processing message with error
        console.error('[DO] Error in LLM call:', error)
        await client.updateMessage(channel, processingTs, `Error: ${error instanceof Error ? error.message : String(error)}`)
        throw error
      }
    } catch (error) {
      console.error('[DO] Slack event handling error:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      await client.postMessage(
        channel,
        truncateForSlack(`Error: ${errorMessage}`),
        threadTs
      )
    }
  }

  /**
   * Get or fetch bot user ID
   */
  private async ensureBotUserId(client: any, appConfig: any): Promise<string | null> {
    if (appConfig.bot_user_id) {
      return appConfig.bot_user_id
    }

    const botUserId = await client.getBotUserId()
    if (botUserId) {
      await this.env.DB.prepare('UPDATE slack_apps SET bot_user_id = ?, updated_at = ? WHERE app_id = ?')
        .bind(botUserId, Date.now(), appConfig.app_id)
        .run()
    }
    return botUserId
  }

  /**
   * Get user info from cache or Slack API
   */
  private async getUserInfo(client: any, appId: string, userId: string): Promise<string> {
    // Try cache first
    const cached = await this.env.DB.prepare('SELECT * FROM slack_users WHERE app_id = ? AND user_id = ?')
      .bind(appId, userId)
      .first() as any

    if (cached) {
      return cached.name
    }

    // Fetch from Slack API
    try {
      const response = await client.getUserInfo(userId)
      if (response.ok && response.user) {
        const user = response.user
        const displayName = user.profile?.display_name || user.real_name || user.name
        const realName = user.real_name || null
        const avatarUrl = user.profile?.image_72 || null

        // Save to cache
        const now = Date.now()
        await this.env.DB.prepare(`
          INSERT INTO slack_users (user_id, app_id, name, real_name, avatar_url, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, app_id) DO UPDATE SET
            name = excluded.name,
            real_name = excluded.real_name,
            avatar_url = excluded.avatar_url,
            updated_at = excluded.updated_at
        `).bind(userId, appId, displayName, realName, avatarUrl, now, now).run()

        return displayName
      }
    } catch (error) {
      console.error('[DO] Failed to fetch user info:', error)
    }

    return userId
  }

  /**
   * Get thread context and find new messages not yet in database
   */
  private async getThreadContext(
    client: any,
    appConfig: any,
    event: any,
    botUserId: string | null
  ): Promise<{ contextMessages: any[], hasError: boolean, errorMessage?: string }> {
    // No thread = no context needed
    if (!event.thread_ts) {
      return { contextMessages: [], hasError: false }
    }

    const threadMessages = await client.getThreadReplies(event.channel!, event.thread_ts)

    // Check for error state: bot messages exist but session is new
    if (this.messages.length === 0) {
      const hasBotMessages = threadMessages.some((msg: any) => msg.bot_id)
      if (hasBotMessages) {
        return {
          contextMessages: [],
          hasError: true,
          errorMessage: 'Error: Thread state inconsistent. Please start a new conversation.'
        }
      }
    }

    // Convert thread messages (exclude current message which is last)
    const historyMessages = threadMessages.slice(0, -1)

    // Collect new user messages from the end until we hit an assistant message
    const rawContextMessages: any[] = []
    for (let i = historyMessages.length - 1; i >= 0; i--) {
      const msg = historyMessages[i]
      // Check if this is a bot message (assistant)
      if (msg.user === botUserId || msg.bot_id) break
      // Only collect user messages (skip system messages or other types)
      if (msg.user && !msg.bot_id) {
        rawContextMessages.unshift(msg)
      }
    }

    // Resolve user IDs to names for all mentions in messages
    const { resolveUserMentionsInMessages, convertSlackUserMessagesToAgentMessages } = await import('../lib/slack')
    const userIdToName = await resolveUserMentionsInMessages(
      rawContextMessages,
      this.env.DB,
      client,
      appConfig.app_id,
      (_db, client, appId, userId) => this.getUserInfo(client, appId, userId)
    )

    // Convert to agent messages
    const contextMessages = convertSlackUserMessagesToAgentMessages(rawContextMessages, userIdToName)

    console.log(`[DO] Found ${contextMessages.length} new user messages after last bot reply (total history: ${historyMessages.length} messages)`)

    return { contextMessages, hasError: false }
  }
}
