/**
 * ChatSession Durable Object
 *
 * Each chat session is represented by a unique Durable Object instance.
 * - Provides strong consistency for real-time chat
 * - Uses D1 for persistent storage
 * - Manages conversation history and streaming responses
 */

import type { DurableObjectState } from '@cloudflare/workers-types'
import { Agent } from '../lib/pi-agent'
import type { AgentMessage } from '../lib/pi-agent/types'
import type { Model } from '../lib/pi-ai/types'
import { createFilesystemContext, createBashTool } from '../lib/tools/bash'
import { createReadTool, createWriteTool, createEditTool, createListTool } from '../lib/tools/file-tools'

interface Env {
  DB: D1Database
}

export class ChatSession {
  private state: DurableObjectState
  private env: Env
  private sessionId: string
  private messages: AgentMessage[] = []
  private initialized = false

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
      const { message, baseUrl, apiKey, model, provider } = await request.json() as {
        message: string
        baseUrl: string
        apiKey: string
        model: string
        provider: string
      }

      if (!message?.trim()) {
        return new Response(JSON.stringify({ error: 'Message is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
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
      this.handleChat(message, baseUrl, apiKey, model, provider, writer, encoder).catch((error) => {
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
   * Handle chat message with streaming
   */
  private async handleChat(
    message: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    provider: string,
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder
  ) {
    try {
      console.log('Starting chat session:', this.sessionId)
      console.log('Message:', message)
      console.log('Base URL:', baseUrl)
      console.log('API Key length:', apiKey?.length || 0)

      // Send session ID
      await writer.write(encoder.encode(
        `data: ${JSON.stringify({ type: 'session_id', sessionId: this.sessionId })}\n\n`
      ))

      // Create agent with existing messages
      const modelConfig = this.buildModel(baseUrl, model, provider)
      console.log('Model:', modelConfig)

      // Create shared filesystem context for all file tools
      const fsContext = createFilesystemContext({
        sessionId: this.sessionId,
        db: this.env.DB
      })

      // Create file operation tools
      const bashTool = createBashTool(fsContext)
      const readTool = createReadTool(fsContext.getBash)
      const writeTool = createWriteTool(fsContext.getBash, fsContext.saveFiles)
      const editTool = createEditTool(fsContext.getBash, fsContext.saveFiles)
      const listTool = createListTool(fsContext.getBash)

      const agent = new Agent({
        initialState: {
          model: modelConfig,
          systemPrompt: `You are a helpful AI assistant built with Hono and Cloudflare Workers.
Be concise and friendly. Format your responses using markdown when appropriate.

You have access to the following tools for working with files:

**File Operations:**
- read: Read the contents of a file
- write: Write content to a file (creates or overwrites)
- edit: Edit a file by replacing specific text
- list: List files and directories

**Bash Commands:**
- bash: Execute shell commands (ls, cat, grep, sed, awk, find, etc.)

All file operations persist to the database and are available across conversations in the same session.
The filesystem starts at /tmp as the working directory.

**When to use each tool:**
- Use \`read\` to view file contents
- Use \`write\` to create new files or completely replace file contents
- Use \`edit\` to make specific changes to existing files
- Use \`list\` to see what files exist
- Use \`bash\` for complex operations, piping, or text processing

Examples:
- Create file: write with path="/tmp/data.txt" and content="Hello World"
- View file: read with path="/tmp/data.txt"
- Edit file: edit with path="/tmp/data.txt", oldText="Hello", newText="Hi"
- List files: list with path="/tmp"
- Process data: bash with command="cat data.txt | sort | uniq"`,
          tools: [readTool, writeTool, editTool, listTool, bashTool],
          messages: this.messages,
        },
        getApiKey: async () => apiKey,
      })

      // Track previous text length to send only deltas
      let previousTextLength = 0
      let eventCount = 0

      // Subscribe to agent events for streaming
      agent.subscribe(async (event) => {
        eventCount++
        console.log('Agent event:', event.type, 'count:', eventCount)
        console.log('Event details:', JSON.stringify(event, null, 2))

        // Extract text from message updates
        if (event.type === 'message_update' && event.message.role === 'assistant') {
          console.log('Assistant message update, content:', JSON.stringify(event.message.content))
          const content = event.message.content
          if (Array.isArray(content)) {
            const textParts = content
              .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
              .map(c => c.text)

            console.log('Text parts:', textParts)
            if (textParts.length > 0) {
              const fullText = textParts.join('')
              // Send only the new delta
              const deltaText = fullText.slice(previousTextLength)
              console.log('Delta text:', deltaText, 'length:', deltaText.length)
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
      console.log('Calling agent.prompt()...')
      await agent.prompt(message)
      console.log('Agent.prompt() completed, event count:', eventCount)

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
