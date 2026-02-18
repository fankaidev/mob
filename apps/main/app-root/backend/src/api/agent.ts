/**
 * Backend Agent API route.
 *
 * POST /api/agent/chat     — Start session, returns SSE stream with heartbeats
 * GET  /api/agent/poll      — Long-poll for events (blocks up to 25s)
 * POST /api/agent/abort     — Abort a running session
 *
 * POST /chat returns an SSE stream:
 *   event: session    — { sessionId } (first event, sent immediately)
 *   event: heartbeat  — {} (every 10s while agent is running)
 *   event: done       — { status } (agent finished or errored)
 * If the Worker is killed, the SSE connection drops and the frontend detects it.
 * The poll endpoint remains the primary way to get event data from DB.
 *
 * Configuration is read from environment secrets:
 * - AGENT_API_URL: LLM API base URL (e.g., "https://api.anthropic.com")
 * - AGENT_API_KEY: LLM API key
 * - AGENT_API_MODEL: Model ID (e.g., "claude-sonnet-4-20250514")
 */

import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { eq, gt, and, desc } from "drizzle-orm"
import type { Env } from "../types/env"
import { Agent } from "../lib/pi-agent/index"
import type { AgentMessage } from "../lib/pi-agent/types"
import type { Model } from "../lib/pi-ai/types"
import { agentSessions, agentSessionEvents } from "../schema"
import { createDbFromEnv, type DbClient } from "../infra/gateway"
import { createAgentFs, createBashTool, createArtifactsTool, createHttpRequestTool, type Artifact } from "../lib/agent/tools"
import { createMountTool, createUnmountTool, createListMountsTool } from "../lib/agent/mount-tools"

// ============================================================================
// Helpers
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
    cost: {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    },
    contextWindow: 200000,
    maxTokens: 16384,
  }
}

/** Serialize a message for JSON storage — strip non-serializable fields */
function serializeMessage(msg: AgentMessage): Record<string, unknown> {
  // AgentMessage is already plain objects, safe for JSON
  return JSON.parse(JSON.stringify(msg))
}

// ============================================================================
// Route definitions
// ============================================================================

const chatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().uuid().optional(), // If provided, continue existing session
})

const pollSchema = z.object({
  sessionId: z.string().uuid(),
  afterEventId: z.coerce.number().int().min(0).optional(),
})

const abortSchema = z.object({
  sessionId: z.string().uuid(),
})

const agentApi = new Hono<Env>()

// POST /chat — Start a new session or continue an existing one.
// Returns an SSE stream: first event is { sessionId }, then periodic heartbeats,
// and a final "done" event. If the Worker is killed, the SSE connection drops
// and the frontend detects it immediately via EventSource onerror.
const HEARTBEAT_INTERVAL_MS = 10_000

agentApi.post(
  "/chat",
  zValidator("json", chatSchema),
  async (c) => {
    const apiUrl = c.env.AGENT_API_URL
    const apiKey = c.env.AGENT_API_KEY
    const apiModel = c.env.AGENT_API_MODEL

    if (!apiUrl || !apiKey || !apiModel) {
      return c.json(
        { error: "Agent not configured. Set AGENT_API_URL, AGENT_API_KEY, and AGENT_API_MODEL secrets." },
        500
      )
    }

    const { message, sessionId: existingSessionId } = c.req.valid("json")
    const db = c.var.db

    let sessionId: string

    if (existingSessionId) {
      // Continue existing session — verify it exists and is not already running
      const session = await db.query.agentSessions.findFirst({
        where: eq(agentSessions.id, existingSessionId),
      })
      if (!session) {
        return c.json({ error: "Session not found" }, 404)
      }
      if (session.status === "running") {
        return c.json({ error: "Session is already running" }, 409)
      }
      // Reset status back to running for the new turn
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

    // Insert user message event
    await db.insert(agentSessionEvents).values({
      sessionId,
      type: "user_message",
      data: { message },
    })

    // Return SSE stream — the agent runs inline (not in waitUntil) so the
    // SSE connection stays alive as long as the Worker is alive.
    const env = c.env
    const isContinuation = !!existingSessionId

    return streamSSE(c, async (stream) => {
      // 1. Send sessionId immediately so the frontend can start polling
      await stream.writeSSE({ event: "session", data: JSON.stringify({ sessionId }) })

      // 2. Run agent with concurrent heartbeats
      let done = false
      let finalStatus = "completed"

      // Heartbeat loop — sends periodic pings to prove the Worker is alive
      const heartbeatPromise = (async () => {
        while (!done) {
          await new Promise((r) => setTimeout(r, HEARTBEAT_INTERVAL_MS))
          if (done) break
          try {
            await stream.writeSSE({ event: "heartbeat", data: "{}" })
          } catch {
            // Stream closed (frontend disconnected or aborted) — stop heartbeating
            break
          }
        }
      })()

      try {
        await runAgentInBackground(env, sessionId, message, apiUrl, apiKey, apiModel, isContinuation)
      } catch {
        finalStatus = "error"
      }

      done = true
      await heartbeatPromise

      // 3. Send done event so frontend knows the agent finished
      try {
        await stream.writeSSE({ event: "done", data: JSON.stringify({ status: finalStatus }) })
      } catch {
        // Stream already closed
      }
    })
  }
)

// GET /poll — Long-poll for session events (blocks up to 25s)
const LONG_POLL_TIMEOUT_MS = 25_000
const LONG_POLL_INTERVAL_MS = 1_000
// If a session has been "running" for longer than this, assume the Worker was killed
const STALE_SESSION_MS = 5 * 60 * 1000 // 5 minutes

agentApi.get(
  "/poll",
  zValidator("query", pollSchema),
  async (c) => {
    const { sessionId, afterEventId } = c.req.valid("query")
    const db = c.var.db

    const buildWhereClause = (eventId?: number) =>
      eventId
        ? and(
            eq(agentSessionEvents.sessionId, sessionId),
            gt(agentSessionEvents.id, eventId)
          )
        : eq(agentSessionEvents.sessionId, sessionId)

    const session = await db.query.agentSessions.findFirst({
      where: eq(agentSessions.id, sessionId),
    })

    if (!session) {
      return c.json({ error: "Session not found" }, 404)
    }

    // Detect zombie sessions: still "running" but created too long ago.
    // This happens when the Cloudflare Worker is killed (CPU limit exceeded)
    // before the catch block can update the session status.
    if (session.status === "running") {
      const sessionAge = Date.now() - new Date(session.createdAt).getTime()
      if (sessionAge > STALE_SESSION_MS) {
        // Auto-recover: mark as error so the frontend stops polling
        await db.update(agentSessions)
          .set({ status: "error", error: "Session timed out (worker may have been terminated)", completedAt: new Date() })
          .where(eq(agentSessions.id, sessionId))
        await db.insert(agentSessionEvents).values({
          sessionId,
          type: "session_error",
          data: { error: "Session timed out — the backend worker may have been terminated by the platform." },
        })

        const events = await db.query.agentSessionEvents.findMany({
          where: buildWhereClause(afterEventId),
          orderBy: (t, { asc }) => [asc(t.id)],
        })

        return c.json({
          status: "error",
          events: events.map((e) => ({ id: e.id, type: e.type, data: e.data })),
        })
      }
    }

    // First check — return immediately if there are events or session is done
    const whereClause = buildWhereClause(afterEventId)
    const events = await db.query.agentSessionEvents.findMany({
      where: whereClause,
      orderBy: (t, { asc }) => [asc(t.id)],
    })

    if (events.length > 0 || session.status !== "running") {
      return c.json({
        status: session.status,
        events: events.map((e) => ({ id: e.id, type: e.type, data: e.data })),
      })
    }

    // Long-poll: block until new events arrive or timeout.
    // The DB connection (Neon WebSocket) may drop during long waits due to idle
    // timeout. If that happens, return gracefully so the client reconnects.
    const deadline = Date.now() + LONG_POLL_TIMEOUT_MS

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, LONG_POLL_INTERVAL_MS))

      try {
        const newEvents = await db.query.agentSessionEvents.findMany({
          where: whereClause,
          orderBy: (t, { asc }) => [asc(t.id)],
        })

        const latestSession = await db.query.agentSessions.findFirst({
          where: eq(agentSessions.id, sessionId),
        })

        if (newEvents.length > 0 || !latestSession || latestSession.status !== "running") {
          return c.json({
            status: latestSession?.status ?? "running",
            events: newEvents.map((e) => ({ id: e.id, type: e.type, data: e.data })),
          })
        }
      } catch {
        // Connection lost (e.g. Neon WebSocket idle timeout) — return so client reconnects
        return c.json({
          status: "running",
          events: [],
        })
      }
    }

    // Timeout — return empty so client can reconnect
    return c.json({
      status: "running",
      events: [],
    })
  }
)

// POST /abort — Abort a running session (DB-based, no cross-request I/O)
agentApi.post(
  "/abort",
  zValidator("json", abortSchema),
  async (c) => {
    const { sessionId } = c.req.valid("json")
    const db = c.var.db

    // Check session exists and is running
    const session = await db.query.agentSessions.findFirst({
      where: eq(agentSessions.id, sessionId),
    })

    if (!session) {
      return c.json({ error: "Session not found" }, 404)
    }

    if (session.status !== "running") {
      return c.json({ ok: true, note: "Session is not running" })
    }

    // Mark session as completed in DB. The background task will detect this
    // status change and call agent.abort() from within its own request context.
    await db.update(agentSessions)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(agentSessions.id, sessionId))

    // Write abort event so the frontend sees it via polling
    await db.insert(agentSessionEvents).values({
      sessionId,
      type: "session_aborted",
      data: {},
    })

    return c.json({ ok: true })
  }
)

// GET /sessions — List all sessions (newest first)
const sessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

agentApi.get(
  "/sessions",
  zValidator("query", sessionsQuerySchema),
  async (c) => {
    const { limit = 50, offset = 0 } = c.req.valid("query")
    const db = c.var.db

    const sessions = await db.query.agentSessions.findMany({
      orderBy: desc(agentSessions.createdAt),
      limit,
      offset,
      columns: {
        id: true,
        message: true,
        status: true,
        eventCount: true,
        createdAt: true,
        completedAt: true,
      },
    })

    return c.json({ sessions })
  }
)

// GET /sessions/:id/messages — Reconstruct messages for a session
agentApi.get(
  "/sessions/:id/messages",
  async (c) => {
    const sessionId = c.req.param("id")
    const db = c.var.db

    const session = await db.query.agentSessions.findFirst({
      where: eq(agentSessions.id, sessionId),
    })

    if (!session) {
      return c.json({ error: "Session not found" }, 404)
    }

    const messages = await rebuildMessagesFromEvents(db, sessionId)

    return c.json({ messages, session: { id: session.id, status: session.status, createdAt: session.createdAt } })
  }
)

// ============================================================================
// Background agent execution
// ============================================================================

/**
 * Serial event queue — ensures DB inserts happen in the exact order
 * events are emitted by the agent, and allows awaiting all pending writes.
 *
 * Also periodically checks DB for external abort signals (from POST /abort)
 * and calls the provided onAbort callback when detected.
 */
function createEventQueue(
  db: DbClient,
  sessionId: string,
  onAbort: () => void,
) {
  let chain: Promise<void> = Promise.resolve()
  let count = 0
  let abortDetected = false
  let lastAbortCheckTime = Date.now()
  const ABORT_CHECK_INTERVAL_MS = 2_000 // Check every 2s

  return {
    /** Enqueue an event to be written serially after all prior events. */
    push(type: string, data: Record<string, unknown>) {
      count++
      chain = chain.then(async () => {
        if (abortDetected) return

        try {
          await db.insert(agentSessionEvents).values({ sessionId, type, data })
        } catch {
          // Don't let event logging failures break the agent
        }

        // Periodically check if session was externally aborted
        const now = Date.now()
        if (now - lastAbortCheckTime >= ABORT_CHECK_INTERVAL_MS) {
          lastAbortCheckTime = now
          try {
            const session = await db.query.agentSessions.findFirst({
              where: eq(agentSessions.id, sessionId),
              columns: { status: true },
            })
            if (session && session.status !== "running") {
              abortDetected = true
              onAbort()
            }
          } catch {
            // Ignore check failures
          }
        }
      })
    },
    /** Wait for every queued write to finish. */
    flush(): Promise<void> {
      return chain
    },
    get count() {
      return count
    },
    get wasAbortedExternally() {
      return abortDetected
    },
  }
}

async function runAgentInBackground(
  env: Env["Bindings"],
  sessionId: string,
  message: string,
  apiUrl: string,
  apiKey: string,
  apiModel: string,
  isContinuation: boolean,
) {
  const { db, pool } = createDbFromEnv(env)

  try {
    const model = buildModel(apiUrl, apiModel)

    // Set up shared filesystem and tools (restores all persisted mounts from DB)
    const sharedFs = await createAgentFs(db)
    const artifacts = new Map<string, Artifact>()

    const bashTool = createBashTool({ fs: sharedFs })
    const artifactsTool = createArtifactsTool({
      getArtifacts: () => artifacts,
      setArtifacts: (newArtifacts) => {
        artifacts.clear()
        for (const [k, v] of newArtifacts) artifacts.set(k, v)
        // Emit artifact_update event
        emitArtifactUpdate(db, sessionId, newArtifacts)
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
        systemPrompt: `You are a helpful AI assistant running on a Cloudflare Worker backend. You have access to:
- A bash tool for executing commands in a sandboxed virtual filesystem
- An artifacts tool for creating and managing files
- An http_request tool for making HTTP requests to external APIs and websites
- A mount tool for mounting external filesystems (e.g. git repos) into the virtual filesystem
- An unmount tool for removing mounted filesystems
- A list_mounts tool for listing all currently mounted external filesystems

When the user asks you to create something visual (HTML page, chart, diagram, etc.), use the artifacts tool with action "create" to create an HTML file.

When the user asks you to write code, text, or documents, use the artifacts tool to create appropriate files.

Use bash for file manipulation, text processing, and running command pipelines.

Use http_request for fetching data from APIs, downloading web content, or any task requiring network access.

Be concise and helpful.`,
      },
      getApiKey: async () => apiKey,
    })

    // If continuing, restore conversation history from DB events
    if (isContinuation) {
      const history = await rebuildMessagesFromEvents(db, sessionId)
      if (history.length > 0) {
        agent.replaceMessages(history)
      }
    }

    // Serial event queue with DB-based abort detection.
    // When POST /abort marks the session as "completed" in DB,
    // the queue detects this and calls agent.abort() from within
    // the same request context (avoiding Cloudflare's cross-request I/O error).
    const eventQueue = createEventQueue(db, sessionId, () => {
      agent.abort()
    })

    agent.subscribe((event) => {
      if (eventQueue.wasAbortedExternally) return

      const eventType = event.type

      // Skip high-frequency streaming events — they are intermediate states
      // (every ~250ms per token batch) not needed for history replay.
      // message_end already contains the complete final message.
      if (eventType === "message_update" || eventType === "message_start") {
        return
      }

      let data: Record<string, unknown> = {}

      switch (eventType) {
        case "agent_start":
        case "agent_end":
        case "turn_start":
          data = {}
          break

        case "turn_end": {
          const te = event as any
          data = {
            message: te.message ? serializeMessage(te.message) : null,
            toolResults: te.toolResults?.map((tr: AgentMessage) => serializeMessage(tr)) ?? [],
          }
          break
        }

        case "message_end": {
          const msg = (event as any).message
          data = { message: msg ? serializeMessage(msg) : null }
          break
        }

        case "tool_execution_start": {
          const tes = event as any
          data = { toolName: tes.toolName, toolCallId: tes.toolCallId, args: tes.args }
          break
        }

        case "tool_execution_end": {
          const tee = event as any
          data = {
            toolName: tee.toolName,
            toolCallId: tee.toolCallId,
            isError: tee.isError,
            result: tee.result,
          }
          break
        }

        case "tool_execution_update": {
          const teu = event as any
          data = { toolName: teu.toolName, toolCallId: teu.toolCallId }
          break
        }
      }

      // Enqueue (synchronous — no await needed, ordering is guaranteed)
      eventQueue.push(eventType, data)
    })

    // Run the agent
    await agent.prompt(message)

    // Wait for all queued event writes to complete before writing session_complete
    await eventQueue.flush()

    // If the session was externally aborted, skip writing completion
    // (POST /abort already wrote the session_aborted event and set status)
    if (eventQueue.wasAbortedExternally) {
      return
    }

    // Extract final usage from last assistant message
    const assistantMessages = agent.state.messages.filter(
      (m) => m.role === "assistant"
    )
    const lastAssistant = assistantMessages[assistantMessages.length - 1]
    const usage = lastAssistant && lastAssistant.role === "assistant"
      ? (lastAssistant as any).usage ?? null
      : null

    // Save complete message history snapshot for future continuation
    const allMessages = agent.state.messages.map(serializeMessage)

    // Update session as completed
    await db.update(agentSessions)
      .set({
        status: "completed",
        response: JSON.stringify(allMessages),
        usage,
        eventCount: eventQueue.count,
        completedAt: new Date(),
      })
      .where(eq(agentSessions.id, sessionId))

    // Insert completion event
    await db.insert(agentSessionEvents).values({
      sessionId,
      type: "session_complete",
      data: { usage },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    try {
      // Check if session was already marked as completed by POST /abort
      const session = await db.query.agentSessions.findFirst({
        where: eq(agentSessions.id, sessionId),
        columns: { status: true },
      })

      if (session?.status === "completed") {
        // Already handled by POST /abort — nothing more to do
        return
      }

      await db.update(agentSessions)
        .set({
          status: "error",
          error: errorMessage,
          completedAt: new Date(),
        })
        .where(eq(agentSessions.id, sessionId))

      await db.insert(agentSessionEvents).values({
        sessionId,
        type: "session_error",
        data: { error: errorMessage },
      })
    } catch {
      // Best effort
    }
  } finally {
    await pool.end()
  }
}

// ============================================================================
// Message reconstruction from DB events
// ============================================================================

/**
 * Rebuild the agent's message history from stored events.
 * Uses message_end events (which contain complete final messages)
 * and turn_end events (which contain toolResults).
 */
async function rebuildMessagesFromEvents(db: DbClient, sessionId: string): Promise<AgentMessage[]> {
  const events = await db.query.agentSessionEvents.findMany({
    where: eq(agentSessionEvents.sessionId, sessionId),
    orderBy: (t, { asc }) => [asc(t.id)],
  })

  const messages: AgentMessage[] = []

  for (const event of events) {
    const data = event.data as Record<string, unknown> | null
    if (!data) continue

    if (event.type === "user_message" && data.message) {
      // Reconstruct user message
      messages.push({
        role: "user",
        content: [{ type: "text", text: data.message as string }],
        timestamp: new Date(event.createdAt).getTime(),
      } as AgentMessage)
    }

    if (event.type === "message_end" && data.message) {
      const msg = data.message as AgentMessage
      if (msg.role === "assistant") {
        messages.push(msg)
      }
    }

    if (event.type === "turn_end" && data.toolResults) {
      const toolResults = data.toolResults as AgentMessage[]
      for (const tr of toolResults) {
        if (tr.role === "toolResult") {
          messages.push(tr)
        }
      }
    }
  }

  return messages
}

// ============================================================================
// Artifact sync helper
// ============================================================================

async function emitArtifactUpdate(db: DbClient, sessionId: string, artifacts: Map<string, Artifact>) {
  const artifactsList = Array.from(artifacts.entries()).map(([filename, a]) => ({
    filename,
    content: a.content,
  }))

  try {
    await db.insert(agentSessionEvents).values({
      sessionId,
      type: "artifact_update",
      data: { artifacts: artifactsList },
    })
  } catch {
    // Best effort
  }
}

export { agentApi }
export type AgentApiType = typeof agentApi
