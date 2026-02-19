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
    return `You are a helpful AI assistant built with Hono and Cloudflare Workers.
Be concise and friendly. Format your responses using markdown when appropriate.

You have access to the following tools:

**File Operations:**
- read: Read the contents of a file
- write: Write content to a file (creates or overwrites)
- edit: Edit a file by replacing specific text
- list: List files and directories

**Bash Commands:**
- bash: Execute shell commands (ls, cat, grep, sed, awk, find, etc.), only selected commands are supported.
- git: Git commands (status, add, commit, push, checkout, branch, log) - only works in /mnt/git
- gh: GitHub CLI (gh pr create) - only works in /mnt/git

**Git Repository Mounting:**
- mount: Clone and mount a git repository at /mnt/git
- unmount: Remove the mounted repository
- list_mounts: List the currently mounted repository

All file operations work with the shared filesystem. The filesystem starts at /work as the working directory.

**File Persistence:**
- Files under /work are **shared and persistent** across all sessions
- Other directories (like /tmp) are session-isolated
- Always save important files to /work for persistence

Use 'ls /mnt' or list with path="/mnt" to see mounted repositories.

**When to use each tool:**
- Use \`read\` to view file contents
- Use \`write\` to create new files or completely replace file contents
- Use \`edit\` to make specific changes to existing files
- Use \`list\` to see what files exist
- Use \`bash\` for complex operations, piping, text processing, and git/gh commands
- Use \`mount\` to clone a git repository for browsing

**Workflow example for browsing a git repository:**
1. Mount the repo: mount({ url: "https://github.com/facebook/react.git" })
2. List files: list({ path: "/mnt/git" }) or bash({ command: "ls /mnt/git" })
3. Read a file: read({ path: "/mnt/git/README.md" })
4. Search code: bash({ command: "grep -r 'useState' /mnt/git/packages --include='*.js'" })

**Workflow example for modifying code and creating a PR:**
1. Mount a forked repo with token: mount({ url: "https://github.com/user/repo.git", token: "ghp_xxx" })
2. Set GITHUB_TOKEN: bash({ command: "export GITHUB_TOKEN=ghp_xxx" })
3. Create a new branch: bash({ command: "cd /mnt/git && git checkout -b fix/typo" })
4. Modify a file: edit({ path: "/mnt/git/README.md", oldText: "...", newText: "..." })
5. Stage and commit: bash({ command: "cd /mnt/git && git add . && git commit -m 'Fix typo'" })
6. Push to remote: bash({ command: "cd /mnt/git && git push" })
7. Create a PR: bash({ command: "cd /mnt/git && gh pr create --title 'Fix typo' --body 'Fixed a typo in README'" })`
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
          tools: [readTool, writeTool, editTool, listTool, bashTool, mountTool, unmountTool, listMountsTool],
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
