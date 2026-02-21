/**
 * Slack events API route
 */

import { Hono } from 'hono'
import type {
  LLMConfig,
  SlackAppConfig,
  SlackEvent,
  SlackPayload,
  SlackUserCache,
} from '../lib/slack'
import {
  convertSlackToAgentMessages,
  extractUserMessage,
  SlackClient,
  truncateForSlack,
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
  threadTs: string | null
): Promise<void> {
  const now = Date.now()
  await db
    .prepare(`
      INSERT INTO slack_thread_mapping (thread_key, session_id, app_id, channel, thread_ts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_key) DO UPDATE SET
        session_id = excluded.session_id,
        updated_at = excluded.updated_at
    `)
    .bind(threadKey, sessionId, appId, channel, threadTs, now, now)
    .run()
}

/**
 * Get user info from cache
 */
async function getCachedUserInfo(
  db: D1Database,
  appId: string,
  userId: string
): Promise<SlackUserCache | null> {
  const result = await db
    .prepare('SELECT * FROM slack_users WHERE app_id = ? AND user_id = ?')
    .bind(appId, userId)
    .first<SlackUserCache>()
  return result || null
}

/**
 * Save user info to cache
 */
async function saveUserInfo(
  db: D1Database,
  appId: string,
  userId: string,
  name: string,
  realName: string | null,
  avatarUrl: string | null
): Promise<void> {
  const now = Date.now()
  await db
    .prepare(`
      INSERT INTO slack_users (user_id, app_id, name, real_name, avatar_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, app_id) DO UPDATE SET
        name = excluded.name,
        real_name = excluded.real_name,
        avatar_url = excluded.avatar_url,
        updated_at = excluded.updated_at
    `)
    .bind(userId, appId, name, realName, avatarUrl, now, now)
    .run()
}

/**
 * Get or fetch user info with caching
 */
async function getUserInfo(
  db: D1Database,
  client: SlackClient,
  appId: string,
  userId: string
): Promise<string> {
  // Try cache first
  const cached = await getCachedUserInfo(db, appId, userId)
  if (cached) {
    return cached.name
  }

  // Fetch from Slack API
  try {
    const response = await client.getUserInfo(userId)
    if (response.ok && response.user) {
      const user = response.user
      // Priority: display_name > real_name > username
      const displayName = user.profile?.display_name || user.real_name || user.name
      const realName = user.real_name || null
      const avatarUrl = user.profile?.image_72 || null

      // Save to cache
      await saveUserInfo(db, appId, userId, displayName, realName, avatarUrl)
      return displayName
    }
  } catch (error) {
    console.error('Failed to fetch user info:', error)
  }

  // Fallback to user ID if everything fails
  return userId
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
 * Get or fetch bot user ID
 */
async function ensureBotUserId(
  db: D1Database,
  client: SlackClient,
  appConfig: SlackAppConfig
): Promise<string | null> {
  if (appConfig.bot_user_id) {
    return appConfig.bot_user_id
  }

  const botUserId = await client.getBotUserId()
  if (botUserId) {
    await updateBotUserId(db, appConfig.app_id, botUserId)
  }
  return botUserId
}

/**
 * Get thread history and find new messages not yet in database
 */
async function getThreadContext(
  db: D1Database,
  client: SlackClient,
  appConfig: SlackAppConfig,
  event: SlackEvent,
  sessionId: string | null,
  botUserId: string | null
): Promise<{ contextMessages: any[], hasError: boolean, errorMessage?: string }> {
  // No thread = no context needed
  if (!event.thread_ts) {
    return { contextMessages: [], hasError: false }
  }

  const threadMessages = await client.getThreadReplies(event.channel!, event.thread_ts)

  // Check for error state: bot messages exist but no session
  if (!sessionId) {
    const hasBotMessages = threadMessages.some(msg => msg.bot_id)
    if (hasBotMessages) {
      return {
        contextMessages: [],
        hasError: true,
        errorMessage: 'Error: Thread state inconsistent. Please start a new conversation.'
      }
    }
  }

  // Convert thread messages (exclude current message which is last)
  const historyMessages = threadMessages.slice(0, -1)
  const allThreadMessages = convertSlackToAgentMessages(historyMessages, botUserId || undefined)

  // Collect new user messages from the end until we hit an assistant message
  const contextMessages: any[] = []
  for (let i = allThreadMessages.length - 1; i >= 0; i--) {
    const msg = allThreadMessages[i]
    if (msg.role === 'assistant') break
    if (msg.role === 'user') {
      // Add user name prefix
      const slackMsg = historyMessages[i]
      if (slackMsg?.user) {
        msg.prefix = `user:${await getUserInfo(db, client, appConfig.app_id, slackMsg.user)}`
      }
      contextMessages.unshift(msg)
    }
  }

  console.log(`Found ${contextMessages.length} new user messages after last bot reply (total history: ${allThreadMessages.length} messages)`)

  return { contextMessages, hasError: false }
}

/**
 * Call ChatSession DO and collect response
 */
async function callChatSession(
  env: Env['Bindings'],
  sessionId: string,
  currentUserMessage: any,
  appConfig: SlackAppConfig,
  contextMessages: any[]
): Promise<string> {
  const doId = env.CHAT_SESSION.idFromName(sessionId)

  // Fail fast: verify id.name is set
  if (!doId.name) {
    console.error('idFromName() did not set name:', { sessionId, idString: doId.toString() })
    throw new Error('Failed to create session')
  }

  const stub = env.CHAT_SESSION.get(doId)

  // Build request
  const chatRequest = {
    message: currentUserMessage,
    llmConfigName: appConfig.llm_config_name,
    contextMessages: contextMessages.length > 0 ? contextMessages : undefined,
    systemPrompt: appConfig.system_prompt || undefined,
    assistantPrefix: `bot:${appConfig.llm_config_name}`,
  }

  // Call ChatSession
  const response = await stub.fetch('http://fake-host/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId,
    },
    body: JSON.stringify(chatRequest),
  })

  // Collect response
  return await collectSSEResponse(response as unknown as globalThis.Response)
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
  const threadKey = getThreadKey(event)

  console.log('handleSlackMessage', event)

  try {
    // Get or fetch bot user ID
    const botUserId = await ensureBotUserId(env.DB, client, appConfig)

    // Validate LLM config exists
    const llmConfig = await getLLMConfig(env.DB, appConfig.llm_config_name)
    if (!llmConfig) {
      await client.postMessage(
        channel,
        `Error: LLM config "${appConfig.llm_config_name}" not found`,
        threadTs
      )
      return
    }

    // Extract and validate user message
    const userMessage = extractUserMessage(event.text || '', botUserId || undefined)
    if (!userMessage && !event.thread_ts) {
      await client.postMessage(
        channel,
        'Please include a message after mentioning me!',
        threadTs
      )
      return
    }

    // Construct current user message with prefix
    const currentUserMessage: any = {
      role: 'user',
      content: [{ type: 'text', text: userMessage }],
      timestamp: Date.now()
    }

    if (event.user) {
      const userName = await getUserInfo(env.DB, client, appConfig.app_id, event.user)
      currentUserMessage.prefix = `user:${userName}`
    }

    // Get or create session
    let sessionId = await getSessionIdFromThreadKey(env.DB, threadKey)

    // Get thread context (history and new messages)
    const { contextMessages, hasError, errorMessage } = await getThreadContext(
      env.DB,
      client,
      appConfig,
      event,
      sessionId,
      botUserId
    )

    if (hasError) {
      await client.postMessage(channel, errorMessage!, threadTs)
      return
    }

    // Create new session if needed
    if (!sessionId) {
      sessionId = generateSessionId('slack')
    }

    // Call ChatSession DO
    const fullResponse = await callChatSession(
      env,
      sessionId,
      currentUserMessage,
      appConfig,
      contextMessages
    )

    // Save thread mapping
    await saveThreadMapping(
      env.DB,
      threadKey,
      sessionId,
      appConfig.app_id,
      channel,
      event.thread_ts || null
    )

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
    // Process asynchronously - return immediately to avoid Slack timeout
    c.executionCtx.waitUntil(handleSlackMessage(c.env, appConfig, event))
    return c.json({ ok: true })
  }

  return c.json({ ok: true })
})

export default slack
