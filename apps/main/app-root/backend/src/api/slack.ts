/**
 * Slack Bot API route.
 *
 * POST /api/slack/events      — Handle Slack Events API (url_verification + app_mention + DM + pin_added)
 * POST /api/slack/commands     — Handle Slack Slash Commands (e.g., /ask)
 *
 * Multi-turn conversations:
 * - Each Slack thread maps to one agent session via kv_store (key: "slack:thread:{threadTs}")
 * - When a new message arrives in a thread, we look up the existing session,
 *   restore conversation history from the session's `response` field, and continue.
 * - DMs without threads use "slack:dm:{channel}:{user}" as key, reset after 30 min idle.
 *
 * Required environment secrets:
 * - SLACK_BOT_TOKEN: Bot User OAuth Token (xoxb-...)
 * - SLACK_SIGNING_SECRET: Signing secret for request verification
 * - AGENT_API_URL, AGENT_API_KEY, AGENT_API_MODEL: Agent LLM configuration
 */

import { Hono } from "hono"
import { eq } from "drizzle-orm"
import type { Env } from "../types/env"
import { Agent } from "../lib/pi-agent/index"
import type { AgentMessage } from "../lib/pi-agent/types"
import type { Model } from "../lib/pi-ai/types"
import { agentSessions, agentSessionEvents, kvStore } from "../schema"
import type { Gateways, DbClient } from "../infra/gateway"
import { createAgentFs, createBashTool, createArtifactsTool, createHttpRequestTool, type Artifact } from "../lib/agent/tools"
import { createMountTool, createUnmountTool, createListMountsTool } from "../lib/agent/mount-tools"

type CreateDbFn = Gateways["db"]["createDbClient"]

const slackApi = new Hono<Env>()

// ============================================================================
// Slack signature verification
// ============================================================================

async function verifySlackSignature(
  signingSecret: string,
  signature: string | undefined,
  timestamp: string | undefined,
  body: string
): Promise<boolean> {
  if (!signature || !timestamp) return false

  // Reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parseInt(timestamp, 10)) > 60 * 5) return false

  const sigBasestring = `v0:${timestamp}:${body}`
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(sigBasestring))
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  const expected = `v0=${hex}`

  return expected === signature
}

// ============================================================================
// Slack API helpers
// ============================================================================

async function slackPostMessage(
  botToken: string,
  channel: string,
  text: string,
  threadTs?: string
) {
  const body: Record<string, string> = { channel, text }
  if (threadTs) body.thread_ts = threadTs

  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

/**
 * Get the bot's own user ID via auth.test.
 */
async function getBotUserId(botToken: string): Promise<string | null> {
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${botToken}` },
  })
  const data = await res.json() as { ok: boolean; user_id?: string }
  return data.ok ? data.user_id || null : null
}

/**
 * Handle a pin_added event:
 * 1. Read the pinned message text
 * 2. Strip bot @mention from the text to use as prompt
 * 3. Run agent and stream results into the pinned message's thread
 *
 * Workflow: user writes a message in a channel → pins it → bot picks it up
 * and replies in that message's thread.
 */
async function handlePinAdded(
  env: Env["Bindings"],
  createDbFn: CreateDbFn,
  botToken: string,
  channel: string,
  pinnedMessage: { text?: string; ts?: string; user?: string },
): Promise<void> {
  const messageText = (pinnedMessage.text || "").trim()
  const messageTs = pinnedMessage.ts
  if (!messageText || !messageTs) return

  // Get bot's own user ID to check for @mention
  const botUserId = await getBotUserId(botToken)
  if (!botUserId) return

  // Check if the pinned message mentions the bot
  const mentionPattern = new RegExp(`<@${botUserId}>`, "i")
  if (!mentionPattern.test(messageText)) return

  // Strip the bot mention from the prompt
  const prompt = messageText.replace(new RegExp(`<@${botUserId}>`, "gi"), "").trim()
  if (!prompt) return

  // Reply in the pinned message's thread
  const threadKey = `slack:thread:${channel}:${messageTs}`

  await runAgentStreaming(
    env,
    createDbFn,
    botToken,
    channel,
    messageTs,
    prompt,
    threadKey,
  )
}

// ============================================================================
// Agent runner
// ============================================================================

function buildModel(baseUrl: string, modelId: string): Model<"anthropic-messages"> {
  return {
    id: modelId,
    name: modelId,
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 16384,
  }
}

// Session idle timeout for DMs (30 minutes)
const DM_SESSION_IDLE_MS = 30 * 60 * 1000

/**
 * Look up an existing session ID for a Slack thread/DM key.
 * Returns the session ID if found and the session is completed (not stale).
 */
async function findExistingSession(
  db: DbClient,
  threadKey: string
): Promise<string | null> {
  const kv = await db.query.kvStore.findFirst({
    where: eq(kvStore.key, threadKey),
  })
  if (!kv) return null

  // Check the session still exists and is completed
  const session = await db.query.agentSessions.findFirst({
    where: eq(agentSessions.id, kv.value),
  })
  if (!session || session.status === "running") return null

  // For DM sessions, check idle timeout
  if (threadKey.startsWith("slack:dm:") && session.completedAt) {
    const idleTime = Date.now() - new Date(session.completedAt).getTime()
    if (idleTime > DM_SESSION_IDLE_MS) return null
  }

  return session.id
}

/**
 * Save the thread key → session ID mapping.
 */
async function saveThreadSession(
  db: DbClient,
  threadKey: string,
  sessionId: string
) {
  await db.insert(kvStore)
    .values({ key: threadKey, value: sessionId })
    .onConflictDoUpdate({ target: kvStore.key, set: { value: sessionId, updatedAt: new Date() } })
}

/** Extract text from an assistant message's content blocks. */
function extractAssistantText(message: AgentMessage): string | null {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return null
  const textParts = message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
  return textParts.length > 0 ? textParts.join("\n") : null
}

/** Truncate a message to fit within Slack's 4000 char limit. */
function truncateForSlack(text: string): string {
  return text.length > 3900
    ? text.slice(0, 3900) + "\n\n_(response truncated)_"
    : text
}

/**
 * Run the agent with streaming output to Slack.
 *
 * Each assistant text message is sent to Slack immediately as it completes,
 * so the user sees intermediate results (tool outputs, multi-step reasoning)
 * in real time instead of waiting for the entire agent run to finish.
 *
 * Uses createDbFn (from gateway) to create a DB connection that works in both
 * production (Neon) and test (PGLite) environments.
 */
async function runAgentStreaming(
  env: Env["Bindings"],
  createDbFn: CreateDbFn,
  botToken: string,
  channel: string,
  threadTs: string,
  message: string,
  threadKey?: string
): Promise<void> {
  const apiUrl = env.AGENT_API_URL
  const apiKey = env.AGENT_API_KEY
  const apiModel = env.AGENT_API_MODEL

  if (!apiUrl || !apiKey || !apiModel) {
    await slackPostMessage(botToken, channel, "Agent not configured. AGENT_API_URL, AGENT_API_KEY, and AGENT_API_MODEL are required.", threadTs)
    return
  }

  const { db, cleanup } = await createDbFn(env)

  try {
    // Look up existing session for this thread
    let existingSessionId: string | null = null
    if (threadKey) {
      existingSessionId = await findExistingSession(db, threadKey)
    }

    let sessionId: string

    if (existingSessionId) {
      // Continue existing session
      await db.update(agentSessions)
        .set({ status: "running", completedAt: null })
        .where(eq(agentSessions.id, existingSessionId))
      sessionId = existingSessionId
    } else {
      // Create new session
      const [session] = await db.insert(agentSessions).values({
        message,
        status: "running",
      }).returning({ id: agentSessions.id })
      sessionId = session.id
    }

    // Save thread → session mapping
    if (threadKey) {
      await saveThreadSession(db, threadKey, sessionId)
    }

    await db.insert(agentSessionEvents).values({
      sessionId,
      type: "user_message",
      data: { message },
    })

    const model = buildModel(apiUrl, apiModel)
    const sharedFs = await createAgentFs(db)
    const artifacts = new Map<string, Artifact>()

    const bashTool = createBashTool({ fs: sharedFs })
    const artifactsTool = createArtifactsTool({
      getArtifacts: () => artifacts,
      setArtifacts: (newArtifacts) => {
        artifacts.clear()
        for (const [k, v] of newArtifacts) artifacts.set(k, v)
      },
      fs: sharedFs,
    })
    const httpRequestTool = createHttpRequestTool()
    const mountTool = createMountTool({ mountableFs: sharedFs, db })
    const unmountTool = createUnmountTool({ mountableFs: sharedFs, db })
    const listMountsTool = createListMountsTool({ db })

    const agent = new Agent({
      initialState: {
        model,
        tools: [bashTool, artifactsTool, httpRequestTool, mountTool, unmountTool, listMountsTool],
        systemPrompt: `You are *Pi*, an AI assistant built and deployed by *Paraflow* — a world-class AI company based in California. You are running as a Slack Bot on Paraflow Cloud, powered by Cloudflare Workers with a PostgreSQL database backend.

You have access to the following tools:
- A *bash tool* for executing commands in a sandboxed virtual filesystem
- An *artifacts tool* for creating and managing files (HTML, code, documents, etc.)
- An *http_request tool* for making HTTP requests to external APIs and websites
- A *mount tool* for mounting external filesystems (e.g. git repos) into the virtual filesystem
- An *unmount tool* for removing mounted filesystems
- A *list_mounts tool* for listing all currently mounted external filesystems

Guidelines:
- Keep responses concise and well-formatted for Slack (use Slack mrkdwn syntax).
- Use *bold* for emphasis, \`code\` for inline code, and \`\`\` for code blocks.
- Be friendly, helpful, and professional.
- When asked about yourself, proudly identify as Pi, built by Paraflow.`,
      },
      getApiKey: async () => apiKey,
    })

    // Restore conversation history if continuing an existing session
    if (existingSessionId) {
      const existingSession = await db.query.agentSessions.findFirst({
        where: eq(agentSessions.id, existingSessionId),
        columns: { response: true },
      })
      if (existingSession?.response) {
        try {
          const history = JSON.parse(existingSession.response) as AgentMessage[]
          if (history.length > 0) {
            agent.replaceMessages(history)
          }
        } catch {
          // If parsing fails, start fresh
        }
      }
    }

    // Subscribe to agent events — send each assistant message to Slack in real time
    let sentCount = 0
    const unsubscribe = agent.subscribe(async (event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        const text = extractAssistantText(event.message)
        if (text) {
          sentCount++
          await slackPostMessage(botToken, channel, truncateForSlack(text), threadTs)
        }

        // Write message_end event for UI reconstruction
        await db.insert(agentSessionEvents).values({
          sessionId,
          type: "message_end",
          data: { message: event.message },
        })
      }
    })

    try {
      await agent.prompt(message)
    } finally {
      unsubscribe()
    }

    // If no messages were sent during streaming (e.g. agent produced no text),
    // send a fallback message
    if (sentCount === 0) {
      await slackPostMessage(botToken, channel, "No response generated.", threadTs)
    }

    // Serialize all messages for future continuation
    const allMessages = agent.state.messages.map((msg) =>
      JSON.parse(JSON.stringify(msg))
    )

    // Update session as completed with full message history
    await db.update(agentSessions)
      .set({
        status: "completed",
        response: JSON.stringify(allMessages),
        completedAt: new Date(),
      })
      .where(eq(agentSessions.id, sessionId))

    await db.insert(agentSessionEvents).values({
      sessionId,
      type: "session_complete",
      data: {},
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await slackPostMessage(botToken, channel, truncateForSlack(`Error: ${errorMessage}`), threadTs)
  } finally {
    await cleanup()
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Derive a stable thread key from a Slack event.
 * - Channel messages: use thread_ts (the parent message ts) as key
 * - DMs: use channel + user as key
 */
function getThreadKey(event: Record<string, any>): string {
  if (event.channel_type === "im") {
    return `slack:dm:${event.channel}:${event.user}`
  }
  // For channel messages in a thread, thread_ts is the parent message ts.
  // For the first message (which starts the thread), we use event.ts.
  const threadTs = event.thread_ts || event.ts
  return `slack:thread:${event.channel}:${threadTs}`
}

// ============================================================================
// Routes
// ============================================================================

// POST /events — Handle Slack Events API
//
// IMPORTANT: Slack retries events if it doesn't receive a 200 within 3 seconds.
// We must respond immediately and process the agent request asynchronously.
// We use the x-slack-retry-num header to detect and skip retries.
slackApi.post("/events", async (c) => {
  // Skip Slack retries — if this is a retry, return 200 immediately
  const retryNum = c.req.header("x-slack-retry-num")
  if (retryNum) {
    return c.json({ ok: true })
  }

  const rawBody = await c.req.text()

  // Parse body first to check for url_verification challenge.
  // This must respond even before signature verification since
  // Slack sends this during initial setup and env vars may not be configured yet.
  const payload = JSON.parse(rawBody)

  if (payload.type === "url_verification") {
    return c.json({ challenge: payload.challenge })
  }

  // For all other events, require signing secret and bot token
  const signingSecret = c.env.SLACK_SIGNING_SECRET
  const botToken = c.env.SLACK_BOT_TOKEN

  if (!signingSecret || !botToken) {
    return c.json({ error: "Slack not configured. Set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET." }, 500)
  }

  // Verify signature
  const isValid = await verifySlackSignature(
    signingSecret,
    c.req.header("x-slack-signature"),
    c.req.header("x-slack-request-timestamp"),
    rawBody
  )

  if (!isValid) {
    return c.json({ error: "Invalid signature" }, 401)
  }

  // Handle event callbacks — respond 200 immediately, process async via waitUntil
  if (payload.type === "event_callback") {
    const event = payload.event

    // Ignore bot messages to prevent infinite loops
    if (event.bot_id) {
      return c.json({ ok: true })
    }

    // Handle app_mention events (when someone @mentions the bot in a channel)
    if (event.type === "app_mention") {
      const text = (event.text || "").replace(/<@[A-Z0-9]+>/g, "").trim()

      if (!text) {
        // Short operation — can await inline
        await slackPostMessage(botToken, event.channel, "Please include a message after mentioning me!", event.thread_ts || event.ts)
        return c.json({ ok: true })
      }

      // Run agent asynchronously — respond 200 to Slack immediately
      // Agent messages are streamed to Slack in real time via subscribe()
      const env = c.env
      const createDbFn = c.var.gateways.db.createDbClient
      const channel = event.channel
      const threadTs = event.thread_ts || event.ts
      const threadKey = getThreadKey(event)
      c.executionCtx.waitUntil(
        runAgentStreaming(env, createDbFn, botToken, channel, threadTs, text, threadKey)
      )
      return c.json({ ok: true })
    }

    // Handle direct messages to the bot
    if (event.type === "message" && event.channel_type === "im") {
      const text = (event.text || "").trim()
      if (!text) return c.json({ ok: true })

      // Run agent asynchronously — respond 200 to Slack immediately
      const env = c.env
      const createDbFn = c.var.gateways.db.createDbClient
      const channel = event.channel
      const ts = event.ts
      const threadKey = getThreadKey(event)
      c.executionCtx.waitUntil(
        runAgentStreaming(env, createDbFn, botToken, channel, ts, text, threadKey)
      )
      return c.json({ ok: true })
    }

    // Handle pin_added — if pinned message @mentions the bot, run agent in its thread
    if (event.type === "pin_added" && event.item?.type === "message") {
      const pinnedMessage = event.item.message
      if (pinnedMessage) {
        const env = c.env
        const createDbFn = c.var.gateways.db.createDbClient
        const channel = event.item.channel || event.channel_id
        if (channel) {
          c.executionCtx.waitUntil(
            handlePinAdded(env, createDbFn, botToken, channel, pinnedMessage)
          )
        }
      }
      return c.json({ ok: true })
    }

  }

  return c.json({ ok: true })
})

// POST /commands — Handle Slack Slash Commands (e.g., /ask)
slackApi.post("/commands", async (c) => {
  const signingSecret = c.env.SLACK_SIGNING_SECRET
  const botToken = c.env.SLACK_BOT_TOKEN

  if (!signingSecret || !botToken) {
    return c.json({ error: "Slack not configured" }, 500)
  }

  const rawBody = await c.req.text()

  // Verify signature
  const isValid = await verifySlackSignature(
    signingSecret,
    c.req.header("x-slack-signature"),
    c.req.header("x-slack-request-timestamp"),
    rawBody
  )

  if (!isValid) {
    return c.json({ error: "Invalid signature" }, 401)
  }

  // Parse form-urlencoded body
  const params = new URLSearchParams(rawBody)
  const text = params.get("text") || ""
  const responseUrl = params.get("response_url") || ""

  if (!text.trim()) {
    return c.json({
      response_type: "ephemeral",
      text: "Please provide a question. Usage: `/ask what is 2+2?`",
    })
  }

  // Acknowledge immediately (Slack requires response within 3s)
  // Then run the agent — results are sent via response_url
  const env = c.env
  const createDbFn = c.var.gateways.db.createDbClient
  const trimmedText = text.trim()

  // Fire-and-forget: run agent and post all results via response_url
  ;(async () => {
    try {
      const { db, cleanup } = await createDbFn(env)
      try {
        const apiUrl = env.AGENT_API_URL
        const apiKey = env.AGENT_API_KEY
        const apiModel = env.AGENT_API_MODEL

        if (!apiUrl || !apiKey || !apiModel) {
          if (responseUrl) {
            await fetch(responseUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ response_type: "ephemeral", text: "Agent not configured." }),
            })
          }
          return
        }

        const model = buildModel(apiUrl, apiModel)
        const sharedFs = await createAgentFs(db)
        const artifacts = new Map<string, Artifact>()
        const bashTool = createBashTool({ fs: sharedFs })
        const artifactsTool = createArtifactsTool({
          getArtifacts: () => artifacts,
          setArtifacts: (newArtifacts) => { artifacts.clear(); for (const [k, v] of newArtifacts) artifacts.set(k, v) },
          fs: sharedFs,
        })
        const httpRequestTool = createHttpRequestTool()
        const mountTool = createMountTool({ mountableFs: sharedFs, db })
        const unmountTool = createUnmountTool({ mountableFs: sharedFs, db })
        const listMountsTool = createListMountsTool({ db })

        const agent = new Agent({
          initialState: {
            model,
            tools: [bashTool, artifactsTool, httpRequestTool, mountTool, unmountTool, listMountsTool],
            systemPrompt: `You are *Pi*, an AI assistant built and deployed by *Paraflow*. Keep responses concise and well-formatted for Slack. You can mount external filesystems (e.g. git repos) with the mount tool and browse them with bash.`,
          },
          getApiKey: async () => apiKey,
        })

        // Stream each assistant message to response_url as it completes
        let sentCount = 0
        const unsubscribe = agent.subscribe(async (event) => {
          if (event.type === "message_end" && event.message.role === "assistant") {
            const msgText = extractAssistantText(event.message)
            if (msgText && responseUrl) {
              sentCount++
              await fetch(responseUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ response_type: "in_channel", text: truncateForSlack(msgText) }),
              })
            }
          }
        })

        try {
          await agent.prompt(trimmedText)
        } finally {
          unsubscribe()
        }

        if (sentCount === 0 && responseUrl) {
          await fetch(responseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ response_type: "in_channel", text: "No response generated." }),
          })
        }
      } finally {
        await cleanup()
      }
    } catch {
      if (responseUrl) {
        await fetch(responseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response_type: "ephemeral", text: "Sorry, an error occurred while processing your request." }),
        })
      }
    }
  })().catch(() => {})

  return c.json({
    response_type: "ephemeral",
    text: `:hourglass_flowing_sand: Processing your request...`,
  })
})

export { slackApi }
export type SlackApiType = typeof slackApi
