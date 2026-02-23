/**
 * TaskExecutor Durable Object (Step 2)
 *
 * This DO continuously polls the database for pending tasks and executes them:
 * 1. Query pending tasks where scheduled_at <= now
 * 2. Mark task as 'running'
 * 3. Execute the task via ChatSession DO
 * 4. Update task status to 'success' or 'error'
 *
 * Benefits:
 * - Single instance guarantees no concurrent execution of the same task
 * - Persistent polling ensures no tasks are missed
 * - Decoupled from cron trigger timing
 */

import type { DurableObjectState } from '@cloudflare/workers-types'

interface Env {
  DB: D1Database
  CHAT_SESSION: DurableObjectNamespace
}

interface PendingTask {
  id: number
  app_id: string
  task_file: string
  cron_expression: string
  scheduled_at: number
}

interface SlackApp {
  app_id: string
  app_name: string
  bot_token: string
  llm_config_name: string
  system_prompt: string | null
}

// Default notification channel for task execution results
const DEFAULT_NOTIFICATION_CHANNEL = 'C08J5HQU9FE'

// Polling interval when idle (no pending tasks)
const IDLE_POLL_INTERVAL_MS = 30000 // 30 seconds

// Polling interval when active (tasks were found)
const ACTIVE_POLL_INTERVAL_MS = 1000 // 1 second

// Maximum execution time per task
const TASK_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export class TaskExecutor {
  private state: DurableObjectState
  private env: Env
  private processing = false
  private alarmScheduled = false

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // POST /process - Trigger task processing
    if (request.method === 'POST' && url.pathname === '/process') {
      // Start processing if not already running
      if (!this.processing) {
        this.processLoop()
      }
      return new Response(JSON.stringify({ status: 'processing' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // GET /status - Get executor status
    if (request.method === 'GET' && url.pathname === '/status') {
      return new Response(JSON.stringify({
        processing: this.processing,
        alarmScheduled: this.alarmScheduled
      }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response('Not found', { status: 404 })
  }

  /**
   * Alarm handler - called by Cloudflare when alarm fires
   */
  async alarm(): Promise<void> {
    this.alarmScheduled = false
    await this.processLoop()
  }

  /**
   * Main processing loop
   */
  private async processLoop(): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      let hasMoreTasks = true

      while (hasMoreTasks) {
        // Get next pending task
        const task = await this.getNextPendingTask()

        if (!task) {
          hasMoreTasks = false
          break
        }

        // Execute the task
        await this.executeTask(task)
      }

      // Schedule next poll
      await this.scheduleNextPoll(false)

    } catch (error) {
      console.error('[TaskExecutor] Error in process loop:', error)
      // Schedule retry on error
      await this.scheduleNextPoll(true)
    } finally {
      this.processing = false
    }
  }

  /**
   * Get next pending task that is ready to execute
   */
  private async getNextPendingTask(): Promise<PendingTask | null> {
    const now = Date.now()

    const result = await this.env.DB.prepare(`
      SELECT id, app_id, task_file, cron_expression, scheduled_at
      FROM task_executions
      WHERE status = 'pending' AND scheduled_at <= ?
      ORDER BY scheduled_at ASC
      LIMIT 1
    `).bind(now).first<PendingTask>()

    return result || null
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: PendingTask): Promise<void> {
    const startTime = Date.now()

    console.log(`[TaskExecutor] Starting task ${task.id}: ${task.task_file}`)

    try {
      // Mark as running
      await this.env.DB.prepare(`
        UPDATE task_executions
        SET status = 'running', started_at = ?
        WHERE id = ? AND status = 'pending'
      `).bind(startTime, task.id).run()

      // Get app config
      const app = await this.env.DB.prepare(`
        SELECT app_id, app_name, bot_token, llm_config_name, system_prompt
        FROM slack_apps
        WHERE app_id = ?
      `).bind(task.app_id).first<SlackApp>()

      if (!app) {
        throw new Error(`App not found: ${task.app_id}`)
      }

      // Get ChatSession DO
      const sessionId = '__shared__'
      const doId = this.env.CHAT_SESSION.idFromName(sessionId)
      const stub = this.env.CHAT_SESSION.get(doId)

      // Read command file
      const commandPath = `/work/agents/${app.app_name}/${task.task_file}`
      const readResponse = await stub.fetch('http://fake-host/read-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: commandPath })
      })

      if (!readResponse.ok) {
        throw new Error(`Command file not found: ${commandPath}`)
      }

      const commandContent = await readResponse.text()

      // Parse markdown file (optional front matter)
      const { prompt, metadata } = this.parseCommandFile(commandContent)

      // Send "task started" notification to Slack
      const notifyChannel = metadata.channel || DEFAULT_NOTIFICATION_CHANNEL
      const startMessageTs = await this.sendTaskStartNotification(app, notifyChannel, task)

      // Execute Agent command with timeout
      const output = await this.executeWithTimeout(
        this.executeAgentCommand(stub, sessionId, app, prompt, metadata),
        TASK_TIMEOUT_MS
      )

      // Mark as success
      const duration = Date.now() - startTime
      await this.env.DB.prepare(`
        UPDATE task_executions
        SET status = 'success', finished_at = ?, duration_ms = ?, output = ?, session_id = ?
        WHERE id = ?
      `).bind(Date.now(), duration, output, sessionId, task.id).run()

      console.log(`[TaskExecutor] Task ${task.id} completed successfully in ${duration}ms`)

      // Send completion result as thread reply
      if (startMessageTs) {
        await this.sendTaskResultToThread(app, notifyChannel, startMessageTs, 'success', output, duration)
      }

    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)
      const isTimeout = errorMessage.includes('timeout')

      console.error(`[TaskExecutor] Task ${task.id} failed:`, error)

      // Send error notification to Slack (as new message since we may not have startMessageTs)
      try {
        const appForNotify = await this.env.DB.prepare(`
          SELECT app_id, app_name, bot_token, llm_config_name, system_prompt FROM slack_apps WHERE app_id = ?
        `).bind(task.app_id).first<SlackApp>()

        if (appForNotify) {
          const errorStartTs = await this.sendTaskStartNotification(appForNotify, DEFAULT_NOTIFICATION_CHANNEL, task)
          if (errorStartTs) {
            await this.sendTaskResultToThread(appForNotify, DEFAULT_NOTIFICATION_CHANNEL, errorStartTs, isTimeout ? 'timeout' : 'error', errorMessage, duration)
          }
        }
      } catch {
        // Ignore notification errors
      }

      await this.env.DB.prepare(`
        UPDATE task_executions
        SET status = ?, finished_at = ?, duration_ms = ?, error_message = ?
        WHERE id = ?
      `).bind(
        isTimeout ? 'timeout' : 'error',
        Date.now(),
        duration,
        errorMessage,
        task.id
      ).run()
    }
  }

  /**
   * Parse command markdown file with optional front matter
   */
  private parseCommandFile(content: string): {
    prompt: string
    metadata: Record<string, string>
  } {
    const metadata: Record<string, string> = {}
    let prompt = content

    // Check for front matter
    const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)

    if (frontMatterMatch) {
      const [, frontMatter, body] = frontMatterMatch
      prompt = body.trim()

      // Parse YAML-like front matter (simple key: value pairs)
      frontMatter.split('\n').forEach(line => {
        const match = line.match(/^(\w+):\s*(.+)$/)
        if (match) {
          const [, key, value] = match
          metadata[key] = value.trim()
        }
      })
    }

    return { prompt, metadata }
  }

  /**
   * Execute Agent command via ChatSession DO
   */
  private async executeAgentCommand(
    stub: DurableObjectStub,
    sessionId: string,
    app: SlackApp,
    prompt: string,
    metadata: Record<string, string>
  ): Promise<string> {
    // Create user message
    const userMessage = {
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      timestamp: Date.now(),
      prefix: `cron:${app.app_name}`
    }

    // Call ChatSession DO
    const chatRequest = {
      message: userMessage,
      llmConfigName: app.llm_config_name,
      systemPrompt: app.system_prompt || undefined
    }

    const response = await stub.fetch('http://fake-host/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify(chatRequest)
    })

    if (!response.ok) {
      throw new Error(`ChatSession request failed: ${response.status}`)
    }

    // Collect SSE response
    const fullResponse = await this.collectSSEResponse(response)

    // Optionally post to Slack if metadata includes channel
    if (metadata.channel && fullResponse) {
      await this.postToSlack(app, metadata.channel, fullResponse, metadata.thread_ts)
    }

    return fullResponse
  }

  /**
   * Execute a promise with timeout
   */
  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Task execution timeout after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    try {
      const result = await Promise.race([promise, timeoutPromise])
      clearTimeout(timeoutId!)
      return result
    } catch (error) {
      clearTimeout(timeoutId!)
      throw error
    }
  }

  /**
   * Collect Server-Sent Events response
   */
  private async collectSSEResponse(response: Response): Promise<string> {
    const reader = response.body?.getReader()
    if (!reader) return ''

    const decoder = new TextDecoder()
    let result = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'text') {
                result += parsed.text
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return result
  }

  /**
   * Post message to Slack
   * Returns the message timestamp (ts) for thread replies
   */
  private async postToSlack(
    app: SlackApp,
    channel: string,
    text: string,
    threadTs?: string
  ): Promise<string | undefined> {
    try {
      const body: Record<string, string> = { channel, text }
      if (threadTs) {
        body.thread_ts = threadTs
      }

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${app.bot_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })

      const result = await response.json() as { ok: boolean; error?: string; ts?: string }

      if (!result.ok) {
        throw new Error(`Slack API error: ${result.error}`)
      }

      console.log(`[TaskExecutor] Posted message to Slack channel ${channel}`)
      return result.ts

    } catch (error) {
      console.error('[TaskExecutor] Failed to post to Slack:', error)
      // Don't throw - posting to Slack is optional
      return undefined
    }
  }

  /**
   * Send "task started" notification to Slack
   * Returns the message timestamp for thread replies
   */
  private async sendTaskStartNotification(
    app: SlackApp,
    channel: string,
    task: PendingTask
  ): Promise<string | undefined> {
    const message = `🚀 *Scheduled task started*\n` +
      `• Task: \`${task.task_file}\`\n` +
      `• Scheduled: ${new Date(task.scheduled_at).toISOString()}`

    return await this.postToSlack(app, channel, message)
  }

  /**
   * Send task result as a thread reply
   */
  private async sendTaskResultToThread(
    app: SlackApp,
    channel: string,
    threadTs: string,
    status: 'success' | 'error' | 'timeout',
    output: string,
    durationMs: number
  ): Promise<void> {
    const statusEmoji = status === 'success' ? '✅' : status === 'timeout' ? '⏱️' : '❌'
    const statusText = status === 'success' ? 'Completed' : status === 'timeout' ? 'Timed out' : 'Failed'
    const durationSec = (durationMs / 1000).toFixed(1)

    // Truncate output if too long
    const maxOutputLen = 2000
    const truncatedOutput = output.length > maxOutputLen
      ? output.slice(0, maxOutputLen) + '\n... (truncated)'
      : output

    const message = `${statusEmoji} *${statusText}* (${durationSec}s)\n\n` +
      (status === 'success' ? truncatedOutput : `\`\`\`\n${truncatedOutput}\n\`\`\``)

    await this.postToSlack(app, channel, message, threadTs)
  }

  /**
   * Schedule next poll using Durable Object alarm
   */
  private async scheduleNextPoll(hadError: boolean): Promise<void> {
    if (this.alarmScheduled) return

    // Check if there are more pending tasks
    const now = Date.now()
    const nextTask = await this.env.DB.prepare(`
      SELECT scheduled_at FROM task_executions
      WHERE status = 'pending'
      ORDER BY scheduled_at ASC
      LIMIT 1
    `).first<{ scheduled_at: number }>()

    let nextPollTime: number

    if (nextTask) {
      if (nextTask.scheduled_at <= now) {
        // Tasks ready now - poll immediately
        nextPollTime = now + ACTIVE_POLL_INTERVAL_MS
      } else {
        // Tasks scheduled in future - wake up when they're ready
        nextPollTime = nextTask.scheduled_at
      }
    } else {
      // No pending tasks - idle poll
      nextPollTime = now + IDLE_POLL_INTERVAL_MS
    }

    // If we had an error, use shorter interval for retry
    if (hadError) {
      nextPollTime = Math.min(nextPollTime, now + ACTIVE_POLL_INTERVAL_MS * 5)
    }

    await this.state.storage.setAlarm(nextPollTime)
    this.alarmScheduled = true

    console.log(`[TaskExecutor] Next poll scheduled at ${new Date(nextPollTime).toISOString()}`)
  }
}
