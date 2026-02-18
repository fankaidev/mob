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
import { Agent } from '../lib/pi-agent'
import type { AgentMessage } from '../lib/pi-agent/types'
import type { Model } from '../lib/pi-ai/types'
import { createBashTool } from '../lib/tools/bash'
import { createMountTool, createUnmountTool, createListMountsTool } from '../lib/tools/mount-tools'
import { InMemoryFs, MountableFs } from '../lib/fs'
import { restoreMounts } from '../lib/fs/mount-store'

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

    // Initialize MountableFs with InMemoryFs base
    const baseFs = new InMemoryFs()
    this.mountableFs = new MountableFs({ base: baseFs })

    // Create /mnt directory for mounts
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

      // Create tools with shared MountableFs
      const toolOptions = {
        sessionId: this.sessionId,
        db: this.env.DB,
        mountableFs: this.mountableFs!,
      }

      const bashTool = createBashTool({
        sessionId: this.sessionId,
        db: this.env.DB,
        fs: this.mountableFs!,
      })

      const mountTool = createMountTool(toolOptions)
      const unmountTool = createUnmountTool(toolOptions)
      const listMountsTool = createListMountsTool(toolOptions)

      const agent = new Agent({
        initialState: {
          model: modelConfig,
          systemPrompt: `You are a helpful AI assistant built with Hono and Cloudflare Workers.
Be concise and friendly. Format your responses using markdown when appropriate.

You have access to several tools:

## bash
Execute shell commands in an isolated environment.
- File operations: cat, ls, cp, mv, rm, mkdir, touch, head, tail, grep, sed, awk, find
- Text processing: echo, printf, wc, sort, uniq, tr, cut
- The filesystem starts at /tmp as the working directory
- Use 'ls /mnt' to see mounted repositories

## mount
Clone and mount a git repository to browse its files.
- Example: mount({ url: "https://github.com/owner/repo.git", mount_path: "/mnt/repo" })
- After mounting, browse files with: bash({ command: "ls /mnt/repo" })
- Supports private repos with token parameter

## unmount
Remove a mounted repository.
- Example: unmount({ mount_path: "/mnt/repo" })

## list_mounts
List all currently mounted repositories.

Workflow example for browsing a git repository:
1. Mount the repo: mount({ url: "https://github.com/facebook/react.git", mount_path: "/mnt/react" })
2. List files: bash({ command: "ls /mnt/react" })
3. Read a file: bash({ command: "cat /mnt/react/README.md" })
4. Search code: bash({ command: "grep -r 'useState' /mnt/react/packages --include='*.js'" })`,
          tools: [bashTool, mountTool, unmountTool, listMountsTool],
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
