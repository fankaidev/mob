/**
 * TaskExecutor Durable Object (Step 2)
 *
 * This DO continuously polls for pending task files and executes them:
 * 1. Scan all agents' cron/ directories for .pending.json files
 * 2. Rename to .running.json
 * 3. Execute the task via ChatSession DO
 * 4. Rename to .done.json (with result in file content)
 *
 * File structure:
 *   /work/agents/{agent_name}/cron/
 *   └── {timestamp}_{task}.{status}.json   # status: pending|running|done
 *
 * Benefits:
 * - Single instance guarantees no concurrent execution of the same task
 * - File-based state is durable and inspectable
 * - Status visible from filename without reading content
 *
 * Safety:
 * - Processes max 1 task per alarm cycle (avoids 15-minute wall clock timeout)
 * - Each task has 12-minute timeout (1 × 12min = 12min < 15min limit)
 * - If more tasks exist, immediately reschedules next alarm (1s interval)
 */

import type { DurableObjectState } from '@cloudflare/workers-types'

interface Env {
  DB: D1Database
  CHAT_SESSION: DurableObjectNamespace
}

interface TaskMetadata {
  app_id: string
  task_file: string
  cron_expression: string
  scheduled_at: number
  created_at: number
  // Added when task completes
  started_at?: number
  finished_at?: number
  duration_ms?: number
  status?: 'success' | 'error' | 'timeout'
  output?: string
  error?: string
}

interface PendingTaskFile {
  path: string
  filename: string
  prefix: string  // {timestamp}_{taskname}
  metadata: TaskMetadata
  agentPath: string
}

interface SlackApp {
  app_id: string
  app_name: string
  bot_token: string
  llm_config_name: string
  system_prompt: string | null
}

// Default notification channel for task execution results
const DEFAULT_NOTIFICATION_CHANNEL = 'C0AG8JCMBBQ'

// Polling interval when idle (no pending tasks)
const IDLE_POLL_INTERVAL_MS = 30000 // 30 seconds

// Polling interval when active (tasks were found)
const ACTIVE_POLL_INTERVAL_MS = 1000 // 1 second

// Maximum execution time per task
const TASK_TIMEOUT_MS = 12 * 60 * 1000 // 12 minutes (allows for longer tasks)

// Maximum tasks to process per alarm cycle (to avoid 15-minute wall clock timeout)
const MAX_TASKS_PER_CYCLE = 1 // 1 task × 12 min = 12 min (safe margin under 15min limit)

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
      } else {
        console.log('[TaskExecutor] Already processing, skipping')
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

    let foundTasks = false
    let tasksProcessed = 0

    try {
      let hasMoreTasks = true

      while (hasMoreTasks && tasksProcessed < MAX_TASKS_PER_CYCLE) {
        // Get next pending task file
        const task = await this.getNextPendingTask()

        if (!task) {
          hasMoreTasks = false
          break
        }

        foundTasks = true
        console.log(`[TaskExecutor] Executing: ${task.filename}`)

        // Execute the task
        await this.executeTask(task)
        tasksProcessed++
      }

      // If we hit the limit, there might be more tasks to process
      if (tasksProcessed >= MAX_TASKS_PER_CYCLE) {
        console.log(`[TaskExecutor] Processed ${tasksProcessed} tasks, rescheduling immediately for remaining tasks`)
        foundTasks = true // Force active polling
      }

      // Schedule next poll
      await this.scheduleNextPoll(foundTasks)

    } catch (error) {
      console.error('[TaskExecutor] Error in process loop:', error)
      // Schedule retry on error
      await this.scheduleNextPoll(true)
    } finally {
      this.processing = false
    }
  }

  /**
   * Get ChatSession stub for file operations (uses __shared__ session)
   */
  private getChatSessionStub() {
    return this.getSessionStub('__shared__')
  }

  /**
   * Get ChatSession stub for a specific session
   */
  private getSessionStub(sessionId: string) {
    const doId = this.env.CHAT_SESSION.idFromName(sessionId)
    return this.env.CHAT_SESSION.get(doId)
  }

  /**
   * Get next pending task that is ready to execute
   */
  private async getNextPendingTask(): Promise<PendingTaskFile | null> {
    const now = Date.now()
    const stub = this.getChatSessionStub()

    // Get all Slack apps to know which agents to scan
    const result = await this.env.DB.prepare('SELECT app_id, app_name FROM slack_apps').all<{ app_id: string; app_name: string }>()
    const apps = result.results

    for (const app of apps) {
      const agentPath = `/work/agents/${app.app_name}`
      const cronDir = `${agentPath}/cron`

      // List cron directory
      const listResponse = await stub.fetch('http://fake-host/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': '__shared__'
        },
        body: JSON.stringify({ path: cronDir })
      })

      if (!listResponse.ok) {
        continue // No cron directory
      }

      const files = await listResponse.json() as string[]

      for (const filename of files) {
        // Only look for .pending.json files
        if (!filename.endsWith('.pending.json')) {
          continue
        }

        // Parse filename: {timestamp}_{taskname}.pending.json
        const match = filename.match(/^(\d+)_(.+)\.pending\.json$/)
        if (!match) {
          console.warn(`[TaskExecutor] Invalid filename format: ${filename}`)
          continue
        }

        const scheduledAt = parseInt(match[1], 10)
        const prefix = `${match[1]}_${match[2]}`

        // Only execute tasks that are due
        if (scheduledAt > now) {
          continue
        }

        // Read task metadata
        const taskPath = `${cronDir}/${filename}`
        const readResponse = await stub.fetch('http://fake-host/read-file', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': '__shared__'
          },
          body: JSON.stringify({ path: taskPath })
        })

        if (!readResponse.ok) {
          console.error(`[TaskExecutor] Failed to read ${filename}: ${readResponse.status}`)
          continue
        }

        try {
          const content = await readResponse.text()
          const metadata = JSON.parse(content) as TaskMetadata

          return {
            path: taskPath,
            filename,
            prefix,
            metadata,
            agentPath
          }
        } catch {
          console.error(`[TaskExecutor] Invalid task file: ${taskPath}`)
          continue
        }
      }
    }

    return null
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: PendingTaskFile): Promise<void> {
    const startTime = Date.now()
    const stub = this.getChatSessionStub()
    const { metadata, prefix, agentPath } = task
    const cronDir = `${agentPath}/cron`

    // Rename to .running.json
    const runningPath = `${cronDir}/${prefix}.running.json`
    await this.renameFile(stub, task.path, runningPath, {
      ...metadata,
      started_at: startTime
    })

    let finalStatus: 'success' | 'error' | 'timeout' = 'error'
    let output = ''
    let errorMessage = ''

    try {
      // Get app config
      const app = await this.env.DB.prepare(`
        SELECT app_id, app_name, bot_token, llm_config_name, system_prompt
        FROM slack_apps
        WHERE app_id = ?
      `).bind(metadata.app_id).first<SlackApp>()

      if (!app) {
        throw new Error(`App not found: ${metadata.app_id}`)
      }

      // Read command file
      const commandPath = `${agentPath}/${metadata.task_file}`
      const readResponse = await stub.fetch('http://fake-host/read-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': '__shared__'
        },
        body: JSON.stringify({ path: commandPath })
      })

      if (!readResponse.ok) {
        throw new Error(`Command file not found: ${commandPath}`)
      }

      const commandContent = await readResponse.text()

      // Parse markdown file (optional front matter)
      const { prompt, metadata: commandMetadata } = this.parseCommandFile(commandContent)

      // Send "task started" notification to Slack
      const notifyChannel = commandMetadata.channel || DEFAULT_NOTIFICATION_CHANNEL
      const startMessageTs = await this.sendTaskStartNotification(app, notifyChannel, metadata)

      // Execute Agent command with timeout
      // Each task gets its own session: cron:{app_name}:{timestamp}
      const taskSessionId = `cron:${app.app_name}:${metadata.scheduled_at}`
      const taskStub = this.getSessionStub(taskSessionId)
      output = await this.executeWithTimeout(
        this.executeAgentCommand(taskStub, taskSessionId, app, prompt, commandMetadata),
        TASK_TIMEOUT_MS
      )

      finalStatus = 'success'

      // Send completion result as thread reply
      if (startMessageTs) {
        const duration = Date.now() - startTime
        await this.sendTaskResultToThread(app, notifyChannel, startMessageTs, 'success', output, duration)
      }

    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
      finalStatus = errorMessage.includes('timeout') ? 'timeout' : 'error'

      console.error(`[TaskExecutor] Task failed: ${prefix}`, error)

      // Send error notification to Slack
      try {
        const app = await this.env.DB.prepare(`
          SELECT app_id, app_name, bot_token, llm_config_name, system_prompt FROM slack_apps WHERE app_id = ?
        `).bind(metadata.app_id).first<SlackApp>()

        if (app) {
          const duration = Date.now() - startTime
          const errorStartTs = await this.sendTaskStartNotification(app, DEFAULT_NOTIFICATION_CHANNEL, metadata)
          if (errorStartTs) {
            await this.sendTaskResultToThread(app, DEFAULT_NOTIFICATION_CHANNEL, errorStartTs, finalStatus, errorMessage, duration)
          }
        }
      } catch {
        // Ignore notification errors
      }
    }

    // Rename to .done.json with final result
    const finishTime = Date.now()
    const donePath = `${cronDir}/${prefix}.done.json`
    await this.renameFile(stub, runningPath, donePath, {
      ...metadata,
      started_at: startTime,
      finished_at: finishTime,
      duration_ms: finishTime - startTime,
      status: finalStatus,
      output: finalStatus === 'success' ? output : undefined,
      error: finalStatus !== 'success' ? errorMessage : undefined
    })

    console.log(`[TaskExecutor] Completed: ${prefix} (${finalStatus}, ${finishTime - startTime}ms)`)
  }

  /**
   * Rename a file by writing new content and deleting old
   */
  private async renameFile(
    stub: ReturnType<typeof this.getChatSessionStub>,
    fromPath: string,
    toPath: string,
    newContent: TaskMetadata
  ): Promise<void> {
    // Write new file with updated content
    const writeResponse = await stub.fetch('http://fake-host/write-file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': '__shared__'
      },
      body: JSON.stringify({ path: toPath, content: JSON.stringify(newContent, null, 2) })
    })

    if (!writeResponse.ok) {
      throw new Error(`Failed to write file: ${toPath}`)
    }

    // Delete old file
    await stub.fetch('http://fake-host/delete-file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': '__shared__'
      },
      body: JSON.stringify({ path: fromPath })
    })
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
    stub: ReturnType<typeof this.getChatSessionStub>,
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

      return result.ts

    } catch (error) {
      console.error('[TaskExecutor] Failed to post to Slack:', error)
      return undefined
    }
  }

  /**
   * Send "task started" notification to Slack
   */
  private async sendTaskStartNotification(
    app: SlackApp,
    channel: string,
    task: TaskMetadata
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
  private async scheduleNextPoll(hadTasks: boolean): Promise<void> {
    if (this.alarmScheduled) return

    const now = Date.now()
    let nextPollTime: number

    if (hadTasks) {
      // Had tasks - check again soon
      nextPollTime = now + ACTIVE_POLL_INTERVAL_MS
    } else {
      // No tasks - idle poll
      nextPollTime = now + IDLE_POLL_INTERVAL_MS
    }

    await this.state.storage.setAlarm(nextPollTime)
    this.alarmScheduled = true
  }
}
