/**
 * Simplified Cron Handler
 *
 * Configuration-as-Code approach:
 * - Commands stored as markdown files in /work/apps/{app_name}/commands/
 * - Schedule defined in /work/apps/{app_name}/crons.txt
 * - Only supports Agent command execution
 */

import type { Env } from '../types'
import { parseExpression } from 'cron-parser'

interface SlackApp {
  app_id: string
  app_name: string
  llm_config_name: string
  system_prompt: string | null
}

interface CronTask {
  cronExpression: string
  taskFile: string
  lineNumber: number
}

/**
 * Main entry point for scheduled tasks
 */
export async function handleScheduledTrigger(env: Env['Bindings']): Promise<void> {
  const now = Date.now()

  console.log('[Cron] Scheduled trigger at', new Date(now).toISOString())

  try {
    // Get all Slack apps
    const result = await env.DB.prepare('SELECT * FROM slack_apps').all<SlackApp>()
    const apps = result.results

    if (apps.length === 0) {
      console.log('[Cron] No apps configured')
      return
    }

    console.log(`[Cron] Found ${apps.length} app(s)`)

    // Process each app's cron tasks
    const executions = apps.map(app => processAppCrons(env, app, now))
    await Promise.allSettled(executions)

  } catch (error) {
    console.error('[Cron] Error in scheduled trigger:', error)
  }
}

/**
 * Process cron tasks for a single app
 */
async function processAppCrons(
  env: Env['Bindings'],
  app: SlackApp,
  now: number
): Promise<void> {
  try {
    const cronsPath = `/work/apps/${app.app_name}/crons.txt`

    // Get session for this app (use __shared__ session for file access)
    const sessionId = '__shared__'
    const doId = env.CHAT_SESSION.idFromName(sessionId)
    const stub = env.CHAT_SESSION.get(doId)

    // Try to read crons.txt
    const readResponse = await stub.fetch('http://fake-host/read-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: cronsPath })
    })

    if (!readResponse.ok) {
      // No crons.txt file for this app
      console.log(`[Cron] No crons.txt found for app ${app.app_name}`)
      return
    }

    const cronsContent = await readResponse.text()

    // Parse crons.txt
    const tasks = parseCronsFile(cronsContent)

    if (tasks.length === 0) {
      console.log(`[Cron] No tasks defined for app ${app.app_name}`)
      return
    }

    console.log(`[Cron] App ${app.app_name}: found ${tasks.length} task(s)`)

    // Check which tasks should run now
    const tasksToRun = tasks.filter(task => shouldRunNow(task.cronExpression, now))

    if (tasksToRun.length === 0) {
      console.log(`[Cron] App ${app.app_name}: no tasks to run at this time`)
      return
    }

    console.log(`[Cron] App ${app.app_name}: running ${tasksToRun.length} task(s)`)

    // Execute tasks in parallel
    const executions = tasksToRun.map(task =>
      executeTask(env, app, task, sessionId, stub)
    )
    await Promise.allSettled(executions)

  } catch (error) {
    console.error(`[Cron] Error processing app ${app.app_name}:`, error)
  }
}

/**
 * Parse crons.txt file format:
 * # Comment
 * */5 * * * * commands/check.md
 * 0 9 * * * commands/report.md
 */
function parseCronsFile(content: string): CronTask[] {
  const tasks: CronTask[] = []
  const lines = content.split('\n')

  lines.forEach((line, index) => {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      return
    }

    // Parse: "*/5 * * * * commands/check.md"
    // Standard cron has 5 fields: minute hour day month weekday
    const parts = trimmed.split(/\s+/)

    if (parts.length < 6) {
      console.warn(`[Cron] Invalid cron format at line ${index + 1}: ${trimmed}`)
      return
    }

    // First 5 parts are cron expression
    const cronExpression = parts.slice(0, 5).join(' ')
    // Remaining parts form the file path
    const taskFile = parts.slice(5).join(' ')

    tasks.push({
      cronExpression,
      taskFile,
      lineNumber: index + 1
    })
  })

  return tasks
}

/**
 * Check if a cron expression matches the current time
 */
function shouldRunNow(cronExpression: string, now: number): boolean {
  try {
    const interval = parseExpression(cronExpression, {
      currentDate: new Date(now)
    })

    // Get the previous scheduled time
    const prev = interval.prev()
    const prevTime = prev.toDate().getTime()

    // If the previous scheduled time was within the last minute, we should run
    const diffMs = now - prevTime
    return diffMs >= 0 && diffMs < 60000 // Within last 60 seconds

  } catch (error) {
    console.error(`[Cron] Invalid cron expression "${cronExpression}":`, error)
    return false
  }
}

/**
 * Execute a single task
 */
async function executeTask(
  env: Env['Bindings'],
  app: SlackApp,
  task: CronTask,
  sessionId: string,
  stub: DurableObjectStub
): Promise<void> {
  const startTime = Date.now()
  let executionId: number | null = null

  try {
    console.log(`[Cron] Executing task: ${task.taskFile} (app: ${app.app_name})`)

    // Create execution record
    executionId = await createExecution(env.DB, app.app_id, task)

    // Read command file
    const commandPath = `/work/apps/${app.app_name}/${task.taskFile}`
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
    const { prompt, metadata } = parseCommandFile(commandContent)

    // Execute Agent command
    const output = await executeAgentCommand(
      env,
      app,
      stub,
      sessionId,
      prompt,
      metadata
    )

    // Mark execution as success
    const duration = Date.now() - startTime
    await completeExecution(env.DB, executionId, 'success', output, null, duration, sessionId)

    console.log(`[Cron] Task completed successfully: ${task.taskFile}`)

  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    console.error(`[Cron] Task failed: ${task.taskFile}`, error)

    if (executionId) {
      await completeExecution(env.DB, executionId, 'error', null, errorMessage, duration, sessionId)
    }
  }
}

/**
 * Parse command markdown file with optional front matter
 *
 * Format:
 * ---
 * channel: C1234567890
 * thread_ts: 1234567890.123456
 * ---
 *
 * Command prompt goes here...
 */
function parseCommandFile(content: string): {
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
async function executeAgentCommand(
  env: Env['Bindings'],
  app: SlackApp,
  stub: DurableObjectStub,
  sessionId: string,
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
  const fullResponse = await collectSSEResponse(response)

  // Optionally post to Slack if metadata includes channel
  if (metadata.channel && fullResponse) {
    await postToSlack(env, app, metadata.channel, fullResponse, metadata.thread_ts)
  }

  return fullResponse
}

/**
 * Collect Server-Sent Events response
 */
async function collectSSEResponse(response: Response): Promise<string> {
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
async function postToSlack(
  env: Env['Bindings'],
  app: SlackApp,
  channel: string,
  text: string,
  threadTs?: string
): Promise<void> {
  try {
    // Get bot token from app config
    const appConfig = await env.DB.prepare(
      'SELECT bot_token FROM slack_apps WHERE app_id = ?'
    ).bind(app.app_id).first<{ bot_token: string }>()

    if (!appConfig) {
      throw new Error(`App config not found: ${app.app_id}`)
    }

    // Post to Slack
    const body: any = { channel, text }
    if (threadTs) {
      body.thread_ts = threadTs
    }

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${appConfig.bot_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    const result = await response.json() as any

    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error}`)
    }

    console.log(`[Cron] Posted result to Slack channel ${channel}`)

  } catch (error) {
    console.error('[Cron] Failed to post to Slack:', error)
    // Don't throw - posting to Slack is optional
  }
}

/**
 * Create execution record in database
 */
async function createExecution(
  db: D1Database,
  appId: string,
  task: CronTask
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO task_executions (
      app_id, task_file, cron_expression, started_at, status
    ) VALUES (?, ?, ?, ?, 'success')
  `).bind(appId, task.taskFile, task.cronExpression, Date.now()).run()

  return result.meta.last_row_id as number
}

/**
 * Complete execution record
 */
async function completeExecution(
  db: D1Database,
  executionId: number,
  status: string,
  output: string | null,
  errorMessage: string | null,
  duration: number,
  sessionId: string
): Promise<void> {
  await db.prepare(`
    UPDATE task_executions
    SET finished_at = ?,
        status = ?,
        output = ?,
        error_message = ?,
        duration_ms = ?,
        session_id = ?
    WHERE id = ?
  `).bind(
    Date.now(),
    status,
    output,
    errorMessage,
    duration,
    sessionId,
    executionId
  ).run()
}
