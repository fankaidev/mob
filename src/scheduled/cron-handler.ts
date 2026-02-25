/**
 * Cron Handler - Task Scheduler (Step 1)
 *
 * This handler runs every minute and:
 * 1. Scans all agents' crons.txt files
 * 2. Finds tasks scheduled within the next 1 minute
 * 3. Creates task files with .pending status (deduplication by filename prefix)
 *
 * Task execution is handled separately by TaskExecutor DO (Step 2)
 *
 * File structure:
 *   /home/{agent_name}/
 *   ├── crons.txt
 *   ├── commands/{task}.md
 *   └── cron/
 *       └── {timestamp}_{task}.{status}.json   # status: pending|running|done
 */

import type { DurableObjectStub } from '@cloudflare/workers-types'
import type { Env } from '../types'
import { CronExpressionParser } from 'cron-parser'

interface SlackApp {
  app_id: string
  llm_config_name: string
}

interface CronTask {
  cronExpression: string
  taskFile: string
  lineNumber: number
}

// Look ahead window in milliseconds (10 minutes)
const LOOK_AHEAD_MS = 10 * 60 * 1000

/**
 * Main entry point for scheduled task scheduling
 */
export async function handleScheduledTrigger(env: Env['Bindings'], ctx?: ExecutionContext): Promise<void> {
  const now = Date.now()

  try {
    // Get all Slack apps
    const result = await env.DB.prepare('SELECT app_id, llm_config_name FROM slack_apps').all<SlackApp>()
    const apps = result.results

    if (apps.length === 0) {
      return
    }

    // Process each app's cron tasks
    const schedules = apps.map(app => scheduleAppTasks(env, app, now))
    await Promise.allSettled(schedules)

    // Trigger TaskExecutor DO to process pending tasks
    if (ctx) {
      // Use waitUntil to ensure the promise is tracked
      ctx.waitUntil(triggerTaskExecutor(env))
    } else {
      // Fallback if no context provided
      await triggerTaskExecutor(env)
    }

  } catch (error) {
    console.error('[Cron] Error in scheduled trigger:', error)
  }
}

/**
 * Schedule tasks for a single app
 */
async function scheduleAppTasks(
  env: Env['Bindings'],
  app: SlackApp,
  now: number
): Promise<void> {
  try {
    const agentPath = `/home/${app.llm_config_name}`
    const cronsPath = `${agentPath}/crons.txt`

    // Get session for file access (use __shared__ session)
    const sessionId = '__shared__'
    const doId = env.CHAT_SESSION.idFromName(sessionId)
    const stub = env.CHAT_SESSION.get(doId)

    // Try to read crons.txt
    const readResponse = await stub.fetch('http://fake-host/read-file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ path: cronsPath })
    })

    if (!readResponse.ok) {
      // No crons.txt file for this app
      return
    }

    const cronsContent = await readResponse.text()

    // Parse crons.txt
    const tasks = parseCronsFile(cronsContent)

    if (tasks.length === 0) {
      return
    }

    // Ensure cron directory exists
    await stub.fetch('http://fake-host/mkdir', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ path: `${agentPath}/cron` })
    })

    // Find all scheduled times within the look-ahead window
    let scheduledCount = 0
    for (const task of tasks) {
      const scheduledTimes = getScheduledTimes(task.cronExpression, now, LOOK_AHEAD_MS)

      for (const scheduledAt of scheduledTimes) {
        const scheduled = await scheduleTask(stub, agentPath, app.app_id, task, scheduledAt)
        if (scheduled) {
          scheduledCount++
        }
      }
    }

    if (scheduledCount > 0) {
      console.log(`[Cron] Scheduled ${scheduledCount} task(s) for ${app.llm_config_name}`)
    }

  } catch (error) {
    console.error(`[Cron] Error scheduling tasks for app ${app.llm_config_name}:`, error)
  }
}

/**
 * Parse crons.txt file format:
 *   # Comment
 *   *\/5 * * * * commands/check.md
 *   0 9 * * * commands/report.md
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
 * Get all scheduled times for a cron expression within a time window
 * Returns timestamps at minute precision (seconds/ms set to 0)
 */
function getScheduledTimes(cronExpression: string, now: number, windowMs: number): number[] {
  const times: number[] = []

  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: new Date(now)
    })

    const endTime = now + windowMs

    // Iterate through future scheduled times
    while (interval.hasNext()) {
      const next = interval.next()
      const nextTime = next.toDate().getTime()

      if (nextTime > endTime) {
        break
      }

      // Normalize to minute precision
      const minuteTime = Math.floor(nextTime / 60000) * 60000
      times.push(minuteTime)
    }

  } catch (error) {
    console.error(`[Cron] Invalid cron expression "${cronExpression}":`, error)
  }

  return times
}

/**
 * Extract task name from task file path
 * e.g., "commands/daily-report.md" -> "daily-report"
 */
function getTaskName(taskFile: string): string {
  const filename = taskFile.split('/').pop() || taskFile
  return filename.replace(/\.md$/, '')
}

/**
 * Schedule a task by creating a .pending.json file
 * Returns true if task was scheduled, false if already exists
 */
async function scheduleTask(
  stub: DurableObjectStub,
  agentPath: string,
  appId: string,
  task: CronTask,
  scheduledAt: number
): Promise<boolean> {
  // Round up to nearest 10 minutes (precision: :00, :10, :20, :30, :40, :50)
  const TEN_MINUTES_MS = 10 * 60 * 1000
  const originalScheduledAt = scheduledAt
  scheduledAt = Math.ceil(scheduledAt / TEN_MINUTES_MS) * TEN_MINUTES_MS

  const taskName = getTaskName(task.taskFile)

  // Warn if time was rounded
  if (scheduledAt !== originalScheduledAt) {
    console.warn(
      `[Cron] Task "${task.taskFile}" scheduled at ${new Date(originalScheduledAt).toISOString()} ` +
      `rounded up to ${new Date(scheduledAt).toISOString()} (10-minute precision)`
    )
  }

  const filePrefix = `${scheduledAt}_${taskName}`
  const cronDir = `${agentPath}/cron`

  // List cron directory to check for existing task with any status
  const listResponse = await stub.fetch('http://fake-host/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': '__shared__',
      'X-Caller': 'cron-handler'
    },
    body: JSON.stringify({ path: cronDir })
  })

  if (listResponse.ok) {
    const files = await listResponse.json() as string[]
    // Check if any file starts with our prefix (deduplication)
    const exists = files.some(f => f.startsWith(filePrefix))
    if (exists) {
      return false
    }
  }

  // Create pending task file
  const pendingPath = `${cronDir}/${filePrefix}.pending.json`
  const taskContent = JSON.stringify({
    app_id: appId,
    task_file: task.taskFile,
    cron_expression: task.cronExpression,
    scheduled_at: scheduledAt,
    created_at: Date.now()
  }, null, 2)

  const writeResponse = await stub.fetch('http://fake-host/write-file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': '__shared__'
    },
    body: JSON.stringify({ path: pendingPath, content: taskContent })
  })

  if (writeResponse.ok) {
    console.log(`[Cron] Scheduled: ${taskName} at ${new Date(scheduledAt).toISOString()}`)
    return true
  }

  return false
}

/**
 * Trigger TaskExecutor DO to process pending tasks
 */
async function triggerTaskExecutor(env: Env['Bindings']): Promise<void> {
  try {
    const doId = env.TASK_EXECUTOR.idFromName('singleton')
    const stub = env.TASK_EXECUTOR.get(doId)

    // Trigger the TaskExecutor
    const response = await stub.fetch('http://fake-host/process', {
      method: 'POST'
    })

    if (!response.ok) {
      console.error('[Cron] TaskExecutor returned error:', response.status, await response.text())
    }

  } catch (error) {
    console.error('[Cron] Error triggering TaskExecutor:', error)
  }
}
