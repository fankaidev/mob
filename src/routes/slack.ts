/**
 * Slack events API route
 */

import { Hono } from 'hono'
import type { Env } from '../types'
import {
  verifySlackSignature,
  SlackClient,
  truncateForSlack,
  convertSlackToAgentMessages,
  extractUserMessage,
} from '../lib/slack'
import type {
  SlackPayload,
  SlackAppConfig,
  LLMConfig,
  SlackEvent,
} from '../lib/slack'

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
 * Get LLM config by name
 */
async function getLLMConfig(
  db: D1Database,
  configName: string
): Promise<LLMConfig | null> {
  const result = await db
    .prepare('SELECT * FROM llm_configs WHERE name = ?')
    .bind(configName)
    .first<LLMConfig>()
  return result || null
}

/**
 * Update bot_user_id cache in slack_apps
 */
async function updateBotUserId(
  db: D1Database,
  appId: string,
  botUserId: string
): Promise<void> {
  await db
    .prepare('UPDATE slack_apps SET bot_user_id = ?, updated_at = ? WHERE app_id = ?')
    .bind(botUserId, Date.now(), appId)
    .run()
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

/**
 * Save thread -> session mapping
 */
async function saveThreadMapping(
  db: D1Database,
  threadKey: string,
  sessionId: string,
  appId: string,
  channel: string,
  threadTs: string | null,
  userId: string | null
): Promise<void> {
  const now = Date.now()
  await db
    .prepare(`
      INSERT INTO slack_thread_mapping (thread_key, session_id, app_id, channel, thread_ts, user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_key) DO UPDATE SET
        session_id = excluded.session_id,
        updated_at = excluded.updated_at
    `)
    .bind(threadKey, sessionId, appId, channel, threadTs, userId, now, now)
    .run()
}

// ============================================================================
// Thread key generation
// ============================================================================

/**
 * Generate thread key from Slack event
 * Format: slack:{app_id}:{channel}:{thread_ts}
 */
function getThreadKey(appId: string, event: SlackEvent): string {
  const threadTs = event.thread_ts || event.ts
  return `slack:${appId}:${event.channel}:${threadTs}`
}

// ============================================================================
// Message handling
// ============================================================================

/**
 * Collect full response from SSE stream
 */
async function collectSSEResponse(response: globalThis.Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''

  const decoder = new TextDecoder()
  let result = ''

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

  return result
}

/**
 * Handle Slack message asynchronously
 */
async function handleSlackMessage(
  env: Env['Bindings'],
  appConfig: SlackAppConfig,
  event: SlackEvent
): Promise<void> {
  const client = new SlackClient(appConfig.bot_token)
  const channel = event.channel!
  const threadTs = event.thread_ts || event.ts!
  const threadKey = getThreadKey(appConfig.app_id, event)

  try {
    // Get or fetch bot user ID
    let botUserId = appConfig.bot_user_id
    if (!botUserId) {
      botUserId = await client.getBotUserId()
      if (botUserId) {
        await updateBotUserId(env.DB, appConfig.app_id, botUserId)
      }
    }

    // Get LLM config
    const llmConfig = await getLLMConfig(env.DB, appConfig.llm_config_name)
    if (!llmConfig) {
      await client.postMessage(
        channel,
        `Error: LLM config "${appConfig.llm_config_name}" not found`,
        threadTs
      )
      return
    }

    // Extract user message from event
    const userMessage = extractUserMessage(event.text || '', botUserId || undefined)
    if (!userMessage) {
      await client.postMessage(
        channel,
        'Please include a message after mentioning me!',
        threadTs
      )
      return
    }

    // Get thread history if this is a reply in a thread
    let contextMessages: any[] = []
    if (event.thread_ts) {
      const threadMessages = await client.getThreadReplies(channel, event.thread_ts)
      // Exclude the current message (last one) since we'll add it separately
      const historyMessages = threadMessages.slice(0, -1)
      contextMessages = convertSlackToAgentMessages(historyMessages, botUserId || undefined)
    }

    // Check for existing session or create new one
    let sessionId = await getSessionIdFromThreadKey(env.DB, threadKey)
    if (!sessionId) {
      sessionId = crypto.randomUUID()
    }

    // Get Durable Object
    const doId = env.CHAT_SESSION.idFromName(sessionId)
    const stub = env.CHAT_SESSION.get(doId)

    // Build request to ChatSession
    const chatRequest = {
      message: userMessage,
      baseUrl: llmConfig.base_url,
      apiKey: llmConfig.api_key,
      model: llmConfig.model,
      provider: llmConfig.provider,
      contextMessages: contextMessages.length > 0 ? contextMessages : undefined,
      systemPrompt: appConfig.system_prompt || undefined,
    }

    // Call ChatSession
    const response = await stub.fetch('http://fake-host/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chatRequest),
    })

    // Save thread mapping
    await saveThreadMapping(
      env.DB,
      threadKey,
      sessionId,
      appConfig.app_id,
      channel,
      event.thread_ts || null,
      event.user || null
    )

    // Collect response (cast to handle CF Workers Response type)
    const fullResponse = await collectSSEResponse(response as unknown as globalThis.Response)

    // Send reply to Slack
    if (fullResponse) {
      await client.postMessage(channel, truncateForSlack(fullResponse), threadTs)
    } else {
      await client.postMessage(channel, 'No response generated.', threadTs)
    }
  } catch (error) {
    console.error('Slack message handling error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    await client.postMessage(
      channel,
      truncateForSlack(`Error: ${errorMessage}`),
      threadTs
    )
  }
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
    // Process asynchronously - return immediately to avoid Slack timeout
    c.executionCtx.waitUntil(handleSlackMessage(c.env, appConfig, event))
    return c.json({ ok: true })
  }

  return c.json({ ok: true })
})

export default slack
