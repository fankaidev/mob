import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp } from '@backend/app'
import { fakeGateways, getPgliteClientForTest, dbFake } from '@backend/infra/gateway/fake'
import { getTestEnv } from '@bdd-test/setupTestEnv'

/**
 * Feature: Slack Bot Integration
 *
 * As a Slack user, I want to interact with the Pi agent via Slack
 * so that I can get AI-powered assistance directly in my workspace.
 */

// Test secrets
const TEST_SIGNING_SECRET = 'test-slack-signing-secret-12345'
const TEST_BOT_TOKEN = 'xoxb-test-bot-token'
const TEST_AGENT_API_URL = 'https://fake-anthropic.invalid'
const TEST_AGENT_API_KEY = 'test-agent-key'
const TEST_AGENT_API_MODEL = 'claude-test-model'

const slackApp = createApp(fakeGateways)

function getSlackEnv() {
  return {
    ...getTestEnv(),
    SLACK_SIGNING_SECRET: TEST_SIGNING_SECRET,
    SLACK_BOT_TOKEN: TEST_BOT_TOKEN,
    AGENT_API_URL: TEST_AGENT_API_URL,
    AGENT_API_KEY: TEST_AGENT_API_KEY,
    AGENT_API_MODEL: TEST_AGENT_API_MODEL,
  }
}

// =========================================================================
// Mock ExecutionContext — collects waitUntil promises for awaiting
// =========================================================================

const backgroundPromises: Promise<unknown>[] = []

const mockExecutionCtx = {
  waitUntil: (p: Promise<unknown>) => { backgroundPromises.push(p.catch(() => {})) },
  passThroughOnException: () => {},
  props: {},
}

async function flushBackgroundTasks() {
  await Promise.allSettled(backgroundPromises)
  backgroundPromises.length = 0
}

// =========================================================================
// External API mock — intercepts Anthropic + Slack fetch calls
// =========================================================================

function createAnthropicSseResponse(text: string): Response {
  const events = [
    `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","content":[],"model":"claude-test","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n\n`,
    `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`,
    `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"${text}"}}\n\n`,
    `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
    `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}\n\n`,
    `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
  ]
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/**
 * Install a fetch mock that intercepts Anthropic API and Slack API calls.
 * Returns { slackMessages, restore } — call restore() in finally block.
 */
function mockExternalFetch() {
  const originalFetch = globalThis.fetch
  const slackMessages: Array<{ channel: string; text: string; thread_ts?: string }> = []

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(TEST_AGENT_API_URL)) {
      return createAnthropicSseResponse('Hello! I am Pi.')
    }
    if (url.includes('slack.com/api/chat.postMessage')) {
      slackMessages.push(JSON.parse(init?.body as string))
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input, init)
  }) as typeof fetch

  return { slackMessages, restore: () => { globalThis.fetch = originalFetch } }
}

// =========================================================================
// Helpers
// =========================================================================

async function generateSlackSignature(secret: string, timestamp: string, body: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`v0:${timestamp}:${body}`))
  return `v0=${Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')}`
}

function nowTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString()
}

function getTestId(): string {
  return expect.getState().testPath?.replace(/^.*\/tests\//, 'tests/') || 'unknown'
}

/** Send a properly signed Slack event to the app. */
async function sendSlackEvent(event: Record<string, unknown>, extraHeaders?: Record<string, string>) {
  const body = JSON.stringify({ type: 'event_callback', event })
  const timestamp = nowTimestamp()
  const signature = await generateSlackSignature(TEST_SIGNING_SECRET, timestamp, body)
  const request = new Request('http://localhost/api/slack/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-slack-signature': signature,
      'x-slack-request-timestamp': timestamp,
      'x-test-id': getTestId(),
      ...extraHeaders,
    },
    body,
  })
  return slackApp.fetch(request, getSlackEnv(), mockExecutionCtx)
}

/** Send a properly signed Slack slash command to the app. */
async function sendSlashCommand(params: string) {
  const timestamp = nowTimestamp()
  const signature = await generateSlackSignature(TEST_SIGNING_SECRET, timestamp, params)
  const request = new Request('http://localhost/api/slack/commands', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-slack-signature': signature,
      'x-slack-request-timestamp': timestamp,
      'x-test-id': getTestId(),
    },
    body: params,
  })
  return slackApp.fetch(request, getSlackEnv(), mockExecutionCtx)
}

// =========================================================================
// Tests
// =========================================================================

describe('Feature: Slack Bot Integration', () => {

  beforeEach(() => {
    backgroundPromises.length = 0
    dbFake.reset(getTestId())
  })

  it('responds to URL verification challenge (works without signing secret)', async () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' })
    // Deliberately send without signing secret to verify it still works during initial setup
    const request = new Request('http://localhost/api/slack/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    const res = await slackApp.fetch(request, getTestEnv(), mockExecutionCtx)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ challenge: 'abc123' })
  })

  it('rejects requests with invalid signature', async () => {
    const body = JSON.stringify({
      type: 'event_callback',
      event: { type: 'app_mention', text: '<@U123> hi', channel: 'C1', ts: '1' },
    })
    const request = new Request('http://localhost/api/slack/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-slack-signature': 'v0=bad',
        'x-slack-request-timestamp': nowTimestamp(),
        'x-test-id': getTestId(),
      },
      body,
    })
    const res = await slackApp.fetch(request, getSlackEnv(), mockExecutionCtx)

    expect(res.status).toBe(401)
  })

  it('skips Slack retries via x-slack-retry-num header', async () => {
    const res = await sendSlackEvent(
      { type: 'app_mention', text: '<@U123> hello', channel: 'C1', ts: '123' },
      { 'x-slack-retry-num': '1', 'x-slack-retry-reason': 'http_timeout' },
    )

    expect(res.status).toBe(200)
    // Should not trigger any background processing
    expect(backgroundPromises).toHaveLength(0)
  })

  it('ignores bot messages to prevent infinite loops', async () => {
    const client = await getPgliteClientForTest(getTestId())

    await sendSlackEvent({
      type: 'app_mention', text: '<@U123> hello', channel: 'C1', ts: '123',
      bot_id: 'B_BOT',
    })

    const { rows } = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM agent_sessions')
    expect(rows[0]?.count).toBe(0)
  })

  it('app_mention → creates session, writes events, sends Slack reply, maps thread', async () => {
    const client = await getPgliteClientForTest(getTestId())
    const { slackMessages, restore } = mockExternalFetch()

    try {
      const res = await sendSlackEvent({
        type: 'app_mention',
        text: '<@U123> hello Pi',
        channel: 'C_MENTION',
        ts: '1111111111.000001',
        user: 'U_ALICE',
      })
      expect(res.status).toBe(200)
      await flushBackgroundTasks()

      // Slack received reply in the correct thread
      expect(slackMessages).toHaveLength(1)
      expect(slackMessages[0].channel).toBe('C_MENTION')
      expect(slackMessages[0].thread_ts).toBe('1111111111.000001')
      expect(slackMessages[0].text).toBeTruthy()

      // Session created with user's message
      const sessions = await client.query<{ id: string; message: string }>(
        'SELECT id, message FROM agent_sessions LIMIT 1',
      )
      expect(sessions.rows).toHaveLength(1)
      expect(sessions.rows[0].message).toBe('hello Pi')
      const sessionId = sessions.rows[0].id

      // Events written
      const events = await client.query<{ type: string }>(
        'SELECT type FROM agent_session_events WHERE session_id = $1 ORDER BY id', [sessionId],
      )
      expect(events.rows.map(e => e.type)).toContain('user_message')

      // Thread → session mapping in kv_store
      const kv = await client.query<{ value: string }>(
        `SELECT value FROM kv_store WHERE key = 'slack:thread:C_MENTION:1111111111.000001'`,
      )
      expect(kv.rows).toHaveLength(1)
      expect(kv.rows[0].value).toBe(sessionId)
    } finally {
      restore()
    }
  })

  it('DM → creates session, writes events, sends Slack reply, maps DM key', async () => {
    const client = await getPgliteClientForTest(getTestId())
    const { slackMessages, restore } = mockExternalFetch()

    try {
      const res = await sendSlackEvent({
        type: 'message',
        channel_type: 'im',
        text: 'hi from DM',
        channel: 'D_DM_CHAN',
        ts: '2222222222.000001',
        user: 'U_BOB',
      })
      expect(res.status).toBe(200)
      await flushBackgroundTasks()

      // Slack received reply
      expect(slackMessages).toHaveLength(1)
      expect(slackMessages[0].channel).toBe('D_DM_CHAN')
      expect(slackMessages[0].text).toBeTruthy()

      // Session created
      const sessions = await client.query<{ id: string; message: string }>(
        'SELECT id, message FROM agent_sessions LIMIT 1',
      )
      expect(sessions.rows).toHaveLength(1)
      expect(sessions.rows[0].message).toBe('hi from DM')
      const sessionId = sessions.rows[0].id

      // Events written
      const events = await client.query<{ type: string }>(
        'SELECT type FROM agent_session_events WHERE session_id = $1 ORDER BY id', [sessionId],
      )
      expect(events.rows.map(e => e.type)).toContain('user_message')

      // DM key → session mapping
      const kv = await client.query<{ value: string }>(
        `SELECT value FROM kv_store WHERE key = 'slack:dm:D_DM_CHAN:U_BOB'`,
      )
      expect(kv.rows).toHaveLength(1)
      expect(kv.rows[0].value).toBe(sessionId)
    } finally {
      restore()
    }
  })

  it('slash command returns usage hint for empty text, ack for valid text', async () => {
    // Empty text → usage hint
    const emptyRes = await sendSlashCommand('text=&response_url=https://hooks.slack.com/r/test')
    expect(emptyRes.status).toBe(200)
    const emptyData = await emptyRes.json() as { response_type: string; text: string }
    expect(emptyData.response_type).toBe('ephemeral')
    expect(emptyData.text).toContain('/ask')

    // Valid text → processing ack
    const validRes = await sendSlashCommand('text=what+is+2%2B2&response_url=https://hooks.slack.com/r/test')
    expect(validRes.status).toBe(200)
    const validData = await validRes.json() as { response_type: string; text: string }
    expect(validData.response_type).toBe('ephemeral')
    expect(validData.text).toContain('Processing')
  })
})
