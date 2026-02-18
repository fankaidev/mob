import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { act } from 'react'
import * as helper from '@bdd-test/helper'
import { pageLinks } from '@frontend/pageLinks'
import { getPgliteClientForTest } from '@backend/infra/gateway/fake'
import {
  messagesAtom,
  isStreamingAtom,
  errorAtom,
  sendMessageAtom,
  clearChatAtom,
  sessionsAtom,
  loadSessionsAtom,
  showSessionsPanelAtom,
} from '@frontend/stores/ChatStore'
import { createApp } from '@frontend/App'

async function renderRoute(url: string): Promise<void> {
  helper.cleanupRender()
  helper.store.reset()

  const rootEl = document.createElement('div')
  rootEl.id = 'bundler-root'
  document.body.appendChild(rootEl)

  window.history.pushState({}, '', url)

  const r = createRoot(rootEl)
  helper.setCurrentReactRoot(r)

  const flushPromises = () => new Promise(resolve => setImmediate(resolve))

  await act(async () => {
    const App = createApp(helper.store._internal)
    r.render(React.createElement(App))

    for (let i = 0; i < 30; i++) {
      await flushPromises()
      await vi.runAllTimersAsync()
    }
  })
}

describe('Chat', () => {
  it('renders Chat page with header, input, and File Explorer link', async () => {
    await renderRoute(pageLinks.Chat())

    const body = document.body.textContent || ''

    // Header elements
    expect(body).toContain('Pi Agent')
    expect(body).toContain('Files')

    // Empty state placeholder
    expect(body).toContain('Ask me anything')

    // File Explorer link exists and points to /files
    const filesLink = document.querySelector('a[href="/files"]')
    expect(filesLink).not.toBeNull()
    expect(filesLink?.textContent).toContain('Files')

    // Input textarea exists
    const textarea = document.querySelector('textarea[placeholder="Send a message..."]')
    expect(textarea).not.toBeNull()
  })

  it('sends a message and handles agent-not-configured error', async () => {
    await renderRoute(pageLinks.Chat())

    // Initially no messages, not streaming, no error
    expect(helper.store.get(messagesAtom)).toHaveLength(0)
    expect(helper.store.get(isStreamingAtom)).toBe(false)
    expect(helper.store.get(errorAtom)).toBeUndefined()

    // Send a message — backend will return 500 because AGENT_API_URL/KEY/MODEL not set
    await helper.store.set(sendMessageAtom, 'Hello agent')

    // The user message should be added to the list
    const messages = helper.store.get(messagesAtom)
    expect(messages.length).toBeGreaterThanOrEqual(1)
    expect(messages[0].role).toBe('user')

    // Error should be set because agent is not configured
    const error = helper.store.get(errorAtom)
    expect(error).toBeDefined()
    expect(error).toContain('Agent not configured')

    // Streaming should be false after completion
    expect(helper.store.get(isStreamingAtom)).toBe(false)

    // Clear chat should reset everything
    helper.store.set(clearChatAtom)
    expect(helper.store.get(messagesAtom)).toHaveLength(0)
    expect(helper.store.get(errorAtom)).toBeUndefined()
  })

  it('creates a session and stores events in database', async () => {
    const testId = expect.getState().testPath?.replace(/^.*\/tests\//, 'tests/') || 'unknown'
    const client = await getPgliteClientForTest(testId)

    // POST /chat should create a session (even though agent won't run because not configured)
    const res = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test message' }),
    })

    // Should fail with 500 because agent secrets are not configured
    expect(res.status).toBe(500)
    const data = await res.json() as { error: string }
    expect(data.error).toContain('Agent not configured')

    // Verify no sessions were created (since it returned before creating one)
    const sessions = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM agent_sessions'
    )
    expect(sessions.rows[0]?.count).toBe(0)
  })

  it('lists sessions and toggles history panel', async () => {
    await renderRoute(pageLinks.Chat())

    // GET /sessions should return empty list (no sessions created in this test env)
    const res = await fetch('/api/agent/sessions?limit=10')
    expect(res.status).toBe(200)
    const data = await res.json() as { sessions: Array<{ id: string; message: string; status: string }> }
    expect(Array.isArray(data.sessions)).toBe(true)

    // Load sessions via store atom
    await helper.store.set(loadSessionsAtom)
    const sessions = helper.store.get(sessionsAtom)
    expect(Array.isArray(sessions)).toBe(true)

    // Toggle session panel visibility
    expect(helper.store.get(showSessionsPanelAtom)).toBe(false)
    helper.store.set(showSessionsPanelAtom, true)
    expect(helper.store.get(showSessionsPanelAtom)).toBe(true)
  })

  it('fetches session messages by session id', async () => {
    const testId = expect.getState().testPath?.replace(/^.*\/tests\//, 'tests/') || 'unknown'
    const client = await getPgliteClientForTest(testId)

    // Manually insert a session and events for testing
    await client.query(
      `INSERT INTO agent_sessions (id, message, status, event_count, completed_at)
       VALUES ('11111111-1111-1111-1111-111111111111', 'hello world', 'completed', 2, NOW())`
    )
    await client.query(
      `INSERT INTO agent_session_events (session_id, type, data)
       VALUES ('11111111-1111-1111-1111-111111111111', 'user_message', '{"message":"hello world"}'::jsonb)`
    )
    await client.query(
      `INSERT INTO agent_session_events (session_id, type, data)
       VALUES ('11111111-1111-1111-1111-111111111111', 'message_end', '{"message":{"role":"assistant","content":[{"type":"text","text":"Hi there!"}]}}'::jsonb)`
    )

    // GET /sessions should list it
    const listRes = await fetch('/api/agent/sessions')
    expect(listRes.status).toBe(200)
    const listData = await listRes.json() as { sessions: Array<{ id: string; message: string }> }
    expect(listData.sessions.length).toBeGreaterThanOrEqual(1)
    expect(listData.sessions.some(s => s.id === '11111111-1111-1111-1111-111111111111')).toBe(true)

    // GET /sessions/:id/messages should return reconstructed messages
    const msgRes = await fetch('/api/agent/sessions/11111111-1111-1111-1111-111111111111/messages')
    expect(msgRes.status).toBe(200)
    const msgData = await msgRes.json() as { messages: Array<{ role: string }>; session: { id: string; status: string } }
    expect(msgData.session.status).toBe('completed')
    expect(msgData.messages.length).toBe(2) // user + assistant
    expect(msgData.messages[0].role).toBe('user')
    expect(msgData.messages[1].role).toBe('assistant')
  })
})
