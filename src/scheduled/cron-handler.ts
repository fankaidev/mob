/**
 * Cron Handler - Task Scheduler (Step 1)
 *
 * This handler runs every minute and:
 * 1. Scans all apps' crons.txt files
 * 2. Finds tasks scheduled within the next 1 minute
 * 3. Creates pending task records in the database (with deduplication)
 *
 * Task execution is handled separately by TaskExecutor DO (Step 2)
 */

import type { Env } from '../types'
import { CronExpressionParser } from 'cron-parser'

interface SlackApp {
  app_id: string
  app_name: string
}

interface CronTask {
  cronExpression: string
  taskFile: string
  lineNumber: number
}

// Look ahead window in milliseconds (1 minute)
const LOOK_AHEAD_MS = 60 * 1000

/**
 * Main entry point for scheduled task scheduling
 */
export async function handleScheduledTrigger(env: Env['Bindings']): Promise<void> {
  const now = Date.now()

  console.log('[Cron] Scheduled trigger at', new Date(now).toISOString())

  try {
    // Get all Slack apps
    const result = await env.DB.prepare('SELECT app_id, app_name FROM slack_apps').all<SlackApp>()
    const apps = result.results

    if (apps.length === 0) {
      console.log('[Cron] No apps configured')
      return
    }

    console.log(`[Cron] Found ${apps.length} app(s)`)

    // Process each app's cron tasks
    const schedules = apps.map(app => scheduleAppTasks(env, app, now))
    await Promise.allSettled(schedules)

    // Trigger TaskExecutor DO to process pending tasks
    await triggerTaskExecutor(env)

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
    const cronsPath = `/work/agents/${app.app_name}/crons.txt`

    // Get session for file access (use __shared__ session)
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
      // No crons.txt file for this app - skip silently
      return
    }

    const cronsContent = await readResponse.text()

    // Parse crons.txt
    const tasks = parseCronsFile(cronsContent)

    if (tasks.length === 0) {
      return
    }

    console.log(`[Cron] App ${app.app_name}: found ${tasks.length} task definition(s)`)

    // Find all scheduled times within the look-ahead window
    let scheduledCount = 0
    for (const task of tasks) {
      const scheduledTimes = getScheduledTimes(task.cronExpression, now, LOOK_AHEAD_MS)

      for (const scheduledAt of scheduledTimes) {
        const scheduled = await scheduleTask(env.DB, app.app_id, task, scheduledAt)
        if (scheduled) {
          scheduledCount++
        }
      }
    }

    if (scheduledCount > 0) {
      console.log(`[Cron] App ${app.app_name}: scheduled ${scheduledCount} task(s)`)
    }

  } catch (error) {
    console.error(`[Cron] Error scheduling tasks for app ${app.app_name}:`, error)
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
 * Schedule a task in the database (with deduplication)
 * Returns true if task was scheduled, false if already exists
 */
async function scheduleTask(
  db: D1Database,
  appId: string,
  task: CronTask,
  scheduledAt: number
): Promise<boolean> {
  try {
    // Insert with unique constraint - will fail if already exists
    await db.prepare(`
      INSERT INTO task_executions (app_id, task_file, cron_expression, scheduled_at, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).bind(appId, task.taskFile, task.cronExpression, scheduledAt).run()

    console.log(`[Cron] Scheduled: ${task.taskFile} at ${new Date(scheduledAt).toISOString()}`)
    return true

  } catch (error: any) {
    // Unique constraint violation means task already scheduled - this is expected
    if (error.message?.includes('UNIQUE constraint failed')) {
      return false
    }
    throw error
  }
}

/**
 * Trigger TaskExecutor DO to process pending tasks
 */
async function triggerTaskExecutor(env: Env['Bindings']): Promise<void> {
  try {
    const doId = env.TASK_EXECUTOR.idFromName('singleton')
    const stub = env.TASK_EXECUTOR.get(doId)

    // Fire and forget - don't wait for response
    stub.fetch('http://fake-host/process', {
      method: 'POST'
    }).catch(err => {
      console.error('[Cron] Failed to trigger TaskExecutor:', err)
    })

  } catch (error) {
    console.error('[Cron] Error triggering TaskExecutor:', error)
  }
}
