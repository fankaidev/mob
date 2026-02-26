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
  convertSlackMessagesToAgentMessages,
  resolveAllUserMentionsInMessages,
  SlackClient,
  splitForSlack,
  verifySlackSignature
} from '../lib/slack'
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
 * Get session ID and last message timestamp from thread key
 */
async function getSessionFromThreadKey(
  db: D1Database,
  threadKey: string
): Promise<{ sessionId: string; lastMessageTs: string | null } | null> {
  const result = await db
    .prepare('SELECT session_id, last_message_ts FROM slack_thread_mapping WHERE thread_key = ?')
    .bind(threadKey)
    .first<{ session_id: string; last_message_ts: string | null }>()
  if (!result) return null
  return {
    sessionId: result.session_id,
    lastMessageTs: result.last_message_ts
  }
}

/**
 * Save thread -> session mapping with last processed message timestamp
 */
async function saveThreadMapping(
  db: D1Database,
  threadKey: string,
  sessionId: string,
  appId: string,
  channel: string,
  threadTs: string | null,
  lastMessageTs: string
): Promise<void> {
  const now = Date.now()
  await db
    .prepare(`
      INSERT INTO slack_thread_mapping (thread_key, session_id, app_id, channel, thread_ts, last_message_ts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_key) DO UPDATE SET
        session_id = excluded.session_id,
        last_message_ts = excluded.last_message_ts,
        updated_at = excluded.updated_at
    `)
    .bind(threadKey, sessionId, appId, channel, threadTs, lastMessageTs, now, now)
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
 * Format: slack:{app_id}:{channel}:{thread_ts}
 */
function getThreadKey(appId: string, event: SlackEvent): string {
  const threadTs = event.thread_ts || event.ts
  return `slack:${appId}:${event.channel}:${threadTs}`
}

// ============================================================================
// Message handling
// ============================================================================

/** Minimum interval (ms) between Slack message updates to avoid rate limits */
const SLACK_UPDATE_INTERVAL_MS = 2000

/**
 * Stream SSE response to Slack, updating messages as text arrives.
 * When content exceeds Slack's limit, posts additional messages and updates them too.
 * Throttles updates to avoid Slack rate limits.
 */
async function streamSSEResponseToSlack(
  response: globalThis.Response,
  client: SlackClient,
  channel: string,
  threadTs: string
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''

  const decoder = new TextDecoder()
  let result = ''
  let lastUpdateMs = -SLACK_UPDATE_INTERVAL_MS // Allow first update immediately
  const messageTs: string[] = []

  const maybeUpdate = async (text: string, force = false) => {
    const now = Date.now()
    if (!force && now - lastUpdateMs < SLACK_UPDATE_INTERVAL_MS) return
    lastUpdateMs = now
    if (!text.trim()) return

    const chunks = splitForSlack(text)
    for (let i = 0; i < chunks.length; i++) {
      try {
        if (i >= messageTs.length) {
          const msg = await client.postMessage(channel, chunks[i], threadTs)
          if (msg.ok && msg.ts) {
            messageTs.push(msg.ts)
          } else {
            console.error(`[Slack Stream] Failed to post message ${i}:`, JSON.stringify(msg))
            throw new Error(`Failed to post message: ${(msg as any).error || 'unknown error'}`)
          }
        } else {
          const updateResult = await client.updateMessage(channel, messageTs[i], chunks[i])
          if (!updateResult.ok) {
            console.error(`[Slack Stream] Failed to update message ${i} (${messageTs[i]}):`, JSON.stringify(updateResult))
            throw new Error(`Failed to update message: ${(updateResult as any).error || 'unknown error'}`)
          }
        }
      } catch (err) {
        console.error(`[Slack Stream] Error with message ${i}:`, err)
        throw err
      }
    }
  }

  try {
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          if (parsed.type === 'text') {
            result += parsed.text
            await maybeUpdate(result)
          }
          if (parsed.type === 'error') {
            console.error('[Slack Stream] Received error event:', parsed.error)
            throw new Error(parsed.error ?? 'Unknown error')
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'Unknown error') throw e
          // Ignore parse errors for non-JSON lines
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      const line = buffer.trim()
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'text') result += parsed.text
            if (parsed.type === 'error') throw new Error(parsed.error ?? 'Unknown error')
          } catch (e) {
            if (e instanceof Error && e.message !== 'Unknown error') throw e
          }
        }
      }
    }

    // Final update (catches throttled last chunk + remaining buffer)
    // Force update to ensure complete content is sent
    if (result) await maybeUpdate(result, true)

    return result
  } finally {
    reader.releaseLock()
  }
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
  botUserId: string | null,
  lastMessageTs: string | null
): Promise<{ contextMessages: any[], hasError: boolean, errorMessage?: string }> {
  // No thread = no context needed
  if (!event.thread_ts) {
    return { contextMessages: [], hasError: false }
  }

  const threadMessages = await client.getThreadReplies(event.channel!, event.thread_ts)

  // Check for error state: THIS bot's messages exist but no session
  if (!sessionId) {
    const hasThisBotMessages = threadMessages.some(
      msg => msg.user === botUserId || (msg.bot_id && msg.user === botUserId)
    )
    if (hasThisBotMessages) {
      return {
        contextMessages: [],
        hasError: true,
        errorMessage: 'Error: Thread state inconsistent. Please start a new conversation.'
      }
    }
  }

  // Collect new messages based on lastMessageTs
  // Exclude current message (event.ts) to avoid duplication
  const rawContextMessages: any[] = []
  const currentMessageTs = event.ts!

  if (lastMessageTs) {
    // Collect all messages after lastMessageTs but before current message
    for (const msg of threadMessages) {
      // Slack timestamps are comparable as strings since they're in format "1234567890.123456"
      if (msg.ts > lastMessageTs && msg.ts !== currentMessageTs && (msg.user || msg.bot_id)) {
        rawContextMessages.push(msg)
      }
    }
  } else {
    // No lastMessageTs - this is the bot's first time in this thread
    // Collect all messages except the current one
    for (const msg of threadMessages) {
      if (msg.ts !== currentMessageTs && (msg.user || msg.bot_id)) {
        rawContextMessages.push(msg)
      }
    }
  }

  // Resolve all user IDs (including bots) to names
  const userIdToName = await resolveAllUserMentionsInMessages(
    rawContextMessages,
    db,
    client,
    appConfig.app_id,
    getUserInfo
  )

  // Convert to agent messages (handles users, current bot, other bots)
  const contextMessages = convertSlackMessagesToAgentMessages(
    rawContextMessages,
    botUserId,
    userIdToName
  )

  console.log(`Found ${contextMessages.length} new messages after this bot's last reply`)

  return { contextMessages, hasError: false }
}

/**
 * Call ChatSession DO and stream response to Slack
 */
async function callChatSession(
  env: Env['Bindings'],
  sessionId: string,
  currentUserMessage: any,
  appConfig: SlackAppConfig,
  contextMessages: any[],
  streamParams: { client: SlackClient; channel: string; threadTs: string }
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

  // Stream response to Slack with incremental updates
  return await streamSSEResponseToSlack(
    response as unknown as globalThis.Response,
    streamParams.client,
    streamParams.channel,
    streamParams.threadTs
  )
}

/**
 * Handle Slack message from Queue
 */
export async function handleSlackQueueMessage(
  env: Env['Bindings'],
  message: { appConfig: SlackAppConfig; event: SlackEvent }
): Promise<void> {
  const { appConfig, event } = message
  const client = new SlackClient(appConfig.bot_token)
  const channel = event.channel!
  const threadTs = event.thread_ts || event.ts!
  const threadKey = getThreadKey(appConfig.app_id, event)

  console.log('handleSlackQueueMessage', event)

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
    const { extractUserMessage } = await import('../lib/slack')
    const userMessage = await extractUserMessage(
      event.text || '',
      botUserId || undefined,
      env.DB,
      client,
      appConfig.app_id,
      getUserInfo
    )
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
    const sessionData = await getSessionFromThreadKey(env.DB, threadKey)
    let sessionId = sessionData?.sessionId || null
    const lastMessageTs = sessionData?.lastMessageTs || null

    // Get thread context (history and new messages)
    const { contextMessages, hasError, errorMessage } = await getThreadContext(
      env.DB,
      client,
      appConfig,
      event,
      sessionId,
      botUserId,
      lastMessageTs
    )

    if (hasError) {
      await client.postMessage(channel, errorMessage!, threadTs)
      return
    }

    // Create new session if needed
    if (!sessionId) {
      const { generateSessionId } = await import('../lib/utils')
      sessionId = generateSessionId(`${appConfig.llm_config_name}-slack`)
    }
    const processingMsg = await client.postMessage(channel, '---', threadTs)
    if (!processingMsg.ok || !processingMsg.ts) {
      const errorMsg = `Failed to send message: ${(processingMsg as any).error || 'unknown error'}`
      console.error('Slack postMessage failed:', JSON.stringify(processingMsg))
      await client.postMessage(channel, `Error: ${errorMsg}`, threadTs)
      return
    }

    // Call ChatSession DO (streams response to Slack with incremental updates)
    const fullResponse = await callChatSession(
      env,
      sessionId,
      currentUserMessage,
      appConfig,
      contextMessages,
      { client, channel, threadTs }
    )

    // Save thread mapping with current message timestamp
    await saveThreadMapping(
      env.DB,
      threadKey,
      sessionId,
      appConfig.app_id,
      channel,
      event.thread_ts || null,
      event.ts!  // Current message timestamp
    )

    if (!fullResponse?.trim()) {
      await client.postMessage(channel, 'No response generated.', threadTs)
    }
  } catch (error) {
    console.error('Slack message handling error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    const chunks = splitForSlack(`Error: ${errorMessage}`)

    // Send error message in chunks if needed
    for (const chunk of chunks) {
      await client.postMessage(channel, chunk, threadTs)
    }
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
    // Send to Queue for async processing (no time limit)
    await c.env.SLACK_QUEUE.send({
      appConfig,
      event,
    })
    return c.json({ ok: true })
  }

  return c.json({ ok: true })
})

export default slack
