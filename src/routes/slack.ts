/**
 * Slack events API route
 */

import { Hono } from 'hono'
import type {
  SlackAppConfig,
  SlackEvent,
  SlackPayload,
} from '../lib/slack'
import {
  verifySlackSignature,
} from '../lib/slack'
import { generateSessionId } from '../lib/utils'
import type { Env } from '../types'

const slack = new Hono<Env>()

// ============================================================================
// Database helpers
// ============================================================================

/**
 * Get Slack app config by app_id
 */
async function getSlackAppConfig(
  db: D1Database,
  appId: string
): Promise<SlackAppConfig | null> {
  const result = await db
    .prepare('SELECT * FROM slack_apps WHERE app_id = ?')
    .bind(appId)
    .first<SlackAppConfig>()
  return result || null
}


/**
 * Get session ID from thread key
 */
async function getSessionIdFromThreadKey(
  db: D1Database,
  threadKey: string
): Promise<string | null> {
  const result = await db
    .prepare('SELECT session_id FROM slack_thread_mapping WHERE thread_key = ?')
    .bind(threadKey)
    .first<{ session_id: string }>()
  return result?.session_id || null
}

// ============================================================================
// Thread key generation
// ============================================================================

/**
 * Generate thread key from Slack event
 * Format: slack:{channel}:{thread_ts}
 */
function getThreadKey(event: SlackEvent): string {
  const threadTs = event.thread_ts || event.ts
  return `slack:${event.channel}:${threadTs}`
}


// ============================================================================
// Route handler
// ============================================================================

slack.post('/events', async (c) => {
  // Skip Slack retries to avoid duplicate processing
  const retryNum = c.req.header('x-slack-retry-num')
  if (retryNum) {
    console.log('Skipping Slack retry:', retryNum)
    return c.json({ ok: true })
  }

  const rawBody = await c.req.text()
  let payload: SlackPayload

  try {
    payload = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  console.log('slack event payload', payload)

  // Handle URL verification challenge (initial setup)
  if (payload.type === 'url_verification') {
    return c.json({ challenge: payload.challenge })
  }

  // For event callbacks, we need to verify the signature
  if (payload.type !== 'event_callback') {
    return c.json({ ok: true })
  }

  const appId = payload.api_app_id
  if (!appId) {
    return c.json({ error: 'Missing api_app_id' }, 400)
  }

  // Get app config from database
  const appConfig = await getSlackAppConfig(c.env.DB, appId)
  if (!appConfig) {
    console.log('Unknown Slack app:', appId)
    return c.json({ error: 'Unknown app' }, 404)
  }

  // Verify signature using the app's signing secret
  const isValid = await verifySlackSignature(
    appConfig.signing_secret,
    c.req.header('x-slack-signature'),
    c.req.header('x-slack-request-timestamp'),
    rawBody
  )

  if (!isValid) {
    console.log('Invalid Slack signature for app:', appId)
    return c.json({ error: 'Invalid signature' }, 401)
  }

  const event = payload.event

  // Ignore bot messages to prevent infinite loops
  if (event.bot_id) {
    return c.json({ ok: true })
  }

  // Handle app_mention event
  if (event.type === 'app_mention') {
    // Fire-and-forget: delegate to ChatSession DO without waiting
    const threadKey = getThreadKey(event)

    // Get or create session ID
    let sessionId = await getSessionIdFromThreadKey(c.env.DB, threadKey)
    if (!sessionId) {
      sessionId = generateSessionId('slack')
    }

    // Get DO stub and call it (fire-and-forget)
    const doId = c.env.CHAT_SESSION.idFromName(sessionId)
    const stub = c.env.CHAT_SESSION.get(doId)

    // Don't wait for result - let DO handle everything
    stub.fetch('http://fake-host/slack-event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId,
      },
      body: JSON.stringify({
        appConfig,
        event,
        threadKey,
      })
    }).catch(err => {
      console.error('[Worker] Failed to call DO:', err)
    })

    // Return immediately to Slack
    return c.json({ ok: true })
  }

  return c.json({ ok: true })
})

export default slack
