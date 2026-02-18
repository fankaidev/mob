import { atom } from 'jotai'
import type { createStore } from 'jotai'
import type { AgentMessage } from '../lib/pi-agent/src/index'
import type { AssistantMessage } from '../lib/pi-ai/src/index'
import type { Artifact } from '../lib/agent/tools'

type Store = ReturnType<typeof createStore>

// ============================================================================
// Agent state atoms
// ============================================================================
export const messagesAtom = atom<AgentMessage[]>([])
export const isStreamingAtom = atom(false)
export const streamMessageAtom = atom<AgentMessage | null>(null)
export const errorAtom = atom<string | undefined>(undefined)

// ============================================================================
// Artifacts atoms
// ============================================================================
export const artifactsAtom = atom<Map<string, Artifact>>(new Map())
export const activeArtifactAtom = atom<string | null>(null)
export const showArtifactsPanelAtom = atom(false)

// ============================================================================
// Session history atoms
// ============================================================================
export type SessionSummary = {
  id: string
  message: string
  status: string
  eventCount: number
  createdAt: string
  completedAt: string | null
}

export const sessionsAtom = atom<SessionSummary[]>([])
export const showSessionsPanelAtom = atom(false)
export const sessionsLoadingAtom = atom(false)

// ============================================================================
// Backend session state
// ============================================================================
let sessionId: string | null = null
let afterEventId = 0
let cancelledRef = false

// ============================================================================
// Polling helper — fetches event data from DB via long-poll
// ============================================================================

type PollEvent = { id: number; type: string; data: any }

// Max time the frontend will poll before giving up (safety net for zombie sessions)
const MAX_POLL_DURATION_MS = 5 * 60 * 1000 // 5 minutes
// Max consecutive empty polls (no new events while status is "running")
const MAX_EMPTY_POLLS = 8 // ~200s with 25s long-poll timeout

async function pollSession(
  sid: string,
  startAfterEventId: number,
  onEvent: (event: PollEvent) => void,
  onStatus: (status: string) => void,
  isCancelled: () => boolean,
): Promise<{ finalStatus: string; lastEventId: number }> {
  let cursor = startAfterEventId
  const pollStartTime = Date.now()
  let emptyPollCount = 0

  while (!isCancelled()) {
    // Safety: give up after MAX_POLL_DURATION_MS
    if (Date.now() - pollStartTime > MAX_POLL_DURATION_MS) {
      return { finalStatus: 'error', lastEventId: cursor }
    }

    const pollUrl = `/api/agent/poll?sessionId=${sid}${cursor ? `&afterEventId=${cursor}` : ''}`
    const pollRes = await fetch(pollUrl)
    if (!pollRes.ok) throw new Error('Polling failed')

    const pollData = await pollRes.json() as {
      status: string
      events: PollEvent[]
    }

    if (pollData.events?.length > 0) {
      emptyPollCount = 0 // reset on activity
      for (const event of pollData.events) {
        cursor = Math.max(cursor, event.id)
        onEvent(event)
      }
    } else if (pollData.status === 'running') {
      emptyPollCount++
      // Too many empty polls = backend is likely dead
      if (emptyPollCount >= MAX_EMPTY_POLLS) {
        return { finalStatus: 'error', lastEventId: cursor }
      }
    }

    onStatus(pollData.status)

    if (pollData.status === 'completed' || pollData.status === 'error') {
      return { finalStatus: pollData.status, lastEventId: cursor }
    }
  }

  return { finalStatus: 'cancelled', lastEventId: cursor }
}

// ============================================================================
// SSE chat helper — POST /chat returns an SSE stream with heartbeats.
// If the Worker is killed, the connection drops and we detect it immediately.
// ============================================================================

/**
 * Start a chat session via SSE. Returns the sessionId and a promise that
 * resolves when the SSE stream closes. If the connection drops unexpectedly
 * (Worker killed), donePromise resolves with wasClean=false.
 */
function startChatSSE(
  message: string,
  existingSessionId: string | null,
  isCancelled: () => boolean,
): {
  sessionIdPromise: Promise<string>
  donePromise: Promise<{ status: string; wasClean: boolean }>
  abort: () => void
} {
  const body: Record<string, string> = { message }
  if (existingSessionId) body.sessionId = existingSessionId

  const abortController = new AbortController()
  let resolveSessionId!: (sid: string) => void
  let rejectSessionId!: (err: Error) => void
  let resolveDone!: (result: { status: string; wasClean: boolean }) => void

  const sessionIdPromise = new Promise<string>((resolve, reject) => {
    resolveSessionId = resolve
    rejectSessionId = reject
  })

  const donePromise = new Promise<{ status: string; wasClean: boolean }>((resolve) => {
    resolveDone = resolve
  })

  // Start the SSE fetch
  ;(async () => {
    let gotSessionId = false
    let gotDone = false

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      })

      // If the response is JSON (error), handle it
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('text/event-stream')) {
        const errData = await res.json() as { error?: string }
        const errMsg = errData.error || `HTTP ${res.status}`
        rejectSessionId(new Error(errMsg))
        resolveDone({ status: 'error', wasClean: true })
        return
      }

      // Parse SSE from the response body stream
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        if (isCancelled()) break
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events from buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // keep incomplete line in buffer

        let currentEvent = ''
        let currentData = ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7)
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6)
          } else if (line === '') {
            // End of event
            if (currentEvent && currentData) {
              if (currentEvent === 'session') {
                const parsed = JSON.parse(currentData) as { sessionId: string }
                gotSessionId = true
                resolveSessionId(parsed.sessionId)
              } else if (currentEvent === 'done') {
                const parsed = JSON.parse(currentData) as { status: string }
                gotDone = true
                resolveDone({ status: parsed.status, wasClean: true })
              }
              // heartbeat events — just proves Worker is alive, nothing to do
            }
            currentEvent = ''
            currentData = ''
          }
        }
      }

      // Stream ended
      if (!gotSessionId) {
        rejectSessionId(new Error('SSE stream ended without session event'))
      }
      if (!gotDone) {
        // Connection dropped without a "done" event — Worker was likely killed
        resolveDone({ status: 'error', wasClean: false })
      }
    } catch (err: any) {
      if (abortController.signal.aborted) {
        // Intentional abort — not an error
        if (!gotSessionId) rejectSessionId(new Error('Aborted'))
        if (!gotDone) resolveDone({ status: 'cancelled', wasClean: true })
      } else {
        // Network error or Worker killed
        if (!gotSessionId) rejectSessionId(err)
        if (!gotDone) resolveDone({ status: 'error', wasClean: false })
      }
    }
  })()

  return {
    sessionIdPromise,
    donePromise,
    abort: () => abortController.abort(),
  }
}

// Track the current SSE abort function
let currentSseAbort: (() => void) | null = null

// ============================================================================
// Actions
// ============================================================================
export const sendMessageAtom = atom(null, async (get, set, text: string) => {
  if (get(isStreamingAtom)) return

  set(isStreamingAtom, true)
  set(errorAtom, undefined)
  set(streamMessageAtom, null)
  cancelledRef = false

  // Add user message to display immediately
  const userMsg: AgentMessage = {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  } as AgentMessage
  set(messagesAtom, [...get(messagesAtom), userMsg])

  try {
    // Start SSE connection — this gives us both the sessionId and liveness detection
    const sse = startChatSSE(text, sessionId, () => cancelledRef)
    currentSseAbort = sse.abort

    // Wait for the sessionId from the first SSE event
    const sid = await sse.sessionIdPromise
    sessionId = sid

    // Process events callback (shared between poll outcomes)
    const onPollEvent = (event: PollEvent) => {
      afterEventId = Math.max(afterEventId, event.id)
      const data = event.data

      if (event.type === 'message_end' && data?.message) {
        set(streamMessageAtom, null)
        set(messagesAtom, [...get(messagesAtom), data.message as AgentMessage])
      }
      if (event.type === 'turn_end' && data?.toolResults) {
        const newResults = (data.toolResults as AgentMessage[]).filter(
          (tr) => tr.role === 'toolResult'
        )
        if (newResults.length > 0) {
          set(messagesAtom, [...get(messagesAtom), ...newResults])
        }
      }
      if (event.type === 'artifact_update' && data?.artifacts) {
        const now = new Date()
        const newArtifacts = new Map<string, Artifact>()
        for (const a of data.artifacts as Array<{ filename: string; content: string }>) {
          const existing = get(artifactsAtom).get(a.filename)
          newArtifacts.set(a.filename, {
            filename: a.filename,
            content: a.content,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          })
        }
        set(artifactsAtom, newArtifacts)
        if (newArtifacts.size > 0) {
          set(showArtifactsPanelAtom, true)
          const activeArt = get(activeArtifactAtom)
          if (!activeArt || !newArtifacts.has(activeArt)) {
            set(activeArtifactAtom, newArtifacts.keys().next().value ?? null)
          }
        }
      }
      if (event.type === 'session_error' && data?.error) {
        set(errorAtom, data.error as string)
      }
    }

    // Start polling for event data in parallel with SSE heartbeat monitoring.
    // pollSession gets the actual data; SSE just proves the Worker is alive.
    const pollPromise = pollSession(
      sid,
      afterEventId,
      onPollEvent,
      () => { /* status updates — we handle via finalStatus */ },
      () => cancelledRef,
    )

    // Race: whichever finishes first determines the outcome.
    // - If SSE drops (Worker killed), donePromise resolves with wasClean=false
    //   → cancel polling and report error
    // - If polling completes first (normal flow), abort SSE connection
    const result = await Promise.race([
      pollPromise.then((r) => ({ source: 'poll' as const, ...r })),
      sse.donePromise.then((r) => ({ source: 'sse' as const, finalStatus: r.status, wasClean: r.wasClean, lastEventId: afterEventId })),
    ])

    if (result.source === 'sse' && !result.wasClean) {
      // SSE connection dropped unexpectedly — Worker was killed
      cancelledRef = true // stop polling
      if (!get(errorAtom)) {
        set(errorAtom, 'Connection to backend lost. The worker may have been terminated.')
      }
    } else if (result.source === 'poll') {
      // Polling completed normally — clean up SSE
      afterEventId = result.lastEventId
      sse.abort()
      if (result.finalStatus === 'error' && !get(errorAtom)) {
        set(errorAtom, 'Agent session ended unexpectedly. The backend worker may have been terminated.')
      }
    } else {
      // SSE done cleanly — wait for polling to finish getting remaining events
      const pollResult = await pollPromise
      afterEventId = pollResult.lastEventId
      if (pollResult.finalStatus === 'error' && !get(errorAtom)) {
        set(errorAtom, 'Agent session ended unexpectedly.')
      }
    }

    currentSseAbort = null
  } catch (err: any) {
    set(errorAtom, err?.message || String(err))
    currentSseAbort = null
  } finally {
    set(isStreamingAtom, false)
    set(streamMessageAtom, null)
  }
})

export const abortAtom = atom(null, async (get, set) => {
  cancelledRef = true
  // Abort SSE connection
  if (currentSseAbort) {
    currentSseAbort()
    currentSseAbort = null
  }
  if (sessionId) {
    try {
      await fetch('/api/agent/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
    } catch { /* best effort */ }
  }
  set(isStreamingAtom, false)
  set(streamMessageAtom, null)
})

export const clearChatAtom = atom(null, (_get, set) => {
  cancelledRef = true
  if (currentSseAbort) {
    currentSseAbort()
    currentSseAbort = null
  }
  sessionId = null
  afterEventId = 0
  set(messagesAtom, [])
  set(streamMessageAtom, null)
  set(isStreamingAtom, false)
  set(errorAtom, undefined)
  set(artifactsAtom, new Map())
  set(activeArtifactAtom, null)
  set(showArtifactsPanelAtom, false)
})

// ============================================================================
// Session history actions
// ============================================================================

export const loadSessionsAtom = atom(null, async (_get, set) => {
  set(sessionsLoadingAtom, true)
  try {
    const res = await fetch('/api/agent/sessions?limit=50')
    if (!res.ok) throw new Error('Failed to load sessions')
    const data = await res.json() as { sessions: SessionSummary[] }
    set(sessionsAtom, data.sessions)
  } catch {
    // Best effort — don't block the UI
  } finally {
    set(sessionsLoadingAtom, false)
  }
})

export const switchSessionAtom = atom(null, async (get, set, targetSessionId: string) => {
  if (get(isStreamingAtom)) return

  // Fetch session messages from backend
  const res = await fetch(`/api/agent/sessions/${targetSessionId}/messages`)
  if (!res.ok) return

  const data = await res.json() as { messages: AgentMessage[]; session: { id: string; status: string } }

  // Reset current state
  cancelledRef = true
  if (currentSseAbort) {
    currentSseAbort()
    currentSseAbort = null
  }

  // Set session context
  sessionId = targetSessionId
  afterEventId = 0 // Will be set correctly on next send
  cancelledRef = false

  // Load messages into state
  set(messagesAtom, data.messages)
  set(streamMessageAtom, null)
  set(isStreamingAtom, false)
  set(errorAtom, undefined)
  set(artifactsAtom, new Map())
  set(activeArtifactAtom, null)
  set(showArtifactsPanelAtom, false)
})

export const newChatAtom = atom(null, (_get, set) => {
  cancelledRef = true
  if (currentSseAbort) {
    currentSseAbort()
    currentSseAbort = null
  }
  sessionId = null
  afterEventId = 0
  set(messagesAtom, [])
  set(streamMessageAtom, null)
  set(isStreamingAtom, false)
  set(errorAtom, undefined)
  set(artifactsAtom, new Map())
  set(activeArtifactAtom, null)
  set(showArtifactsPanelAtom, false)
})

// ============================================================================
// Loader
// ============================================================================
export function loader(_store: Store) {
  return null
}
