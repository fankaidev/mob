import { Hono } from 'hono'
import type { Env } from '../types'

const api = new Hono<Env>()

// GET /sessions - List all sessions
api.get('/sessions', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT
        s.id,
        s.created_at,
        s.updated_at,
        s.status,
        (
          SELECT m.content
          FROM messages m
          WHERE m.session_id = s.id AND m.role = 'user'
          ORDER BY m.created_at ASC
          LIMIT 1
        ) as first_user_message
      FROM sessions s
      ORDER BY s.updated_at DESC
    `).all()

    return c.json({ sessions: result.results })
  } catch (error) {
    console.error('Failed to list sessions:', error)
    return c.json({ error: 'Failed to list sessions' }, 500)
  }
})

// DELETE /session/:id - Delete a session
api.delete('/session/:id', async (c) => {
  try {
    const sessionId = c.req.param('id')

    // Delete messages for this session
    await c.env.DB.prepare(
      'DELETE FROM messages WHERE session_id = ?'
    ).bind(sessionId).run()

    // Delete the session
    await c.env.DB.prepare(
      'DELETE FROM sessions WHERE id = ?'
    ).bind(sessionId).run()

    return c.json({ success: true })
  } catch (error) {
    console.error('Failed to delete session:', error)
    return c.json({ error: 'Failed to delete session' }, 500)
  }
})

// POST /session/:id/chat - Send message and get streaming response
api.post('/session/:id/chat', async (c) => {
  const sessionId = c.req.param('id')
  const body = await c.req.text()

  // Get Durable Object instance
  const id = c.env.CHAT_SESSION.idFromName(sessionId)

  // Fail fast: verify id.name is set
  if (!id.name) {
    console.error('idFromName() did not set name:', { sessionId, idString: id.toString() })
    return c.json({ error: 'Failed to create Durable Object ID with name' }, 500)
  }

  const stub = c.env.CHAT_SESSION.get(id)

  // Forward request to DO with session ID in header
  return stub.fetch('http://fake-host/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId,
    },
    body,
  }) as any
})

// GET /session/:id/history - Get conversation history
api.get('/session/:id/history', async (c) => {
  const sessionId = c.req.param('id')

  try {
    // Query messages directly from D1 (no need to go through DO)
    const result = await c.env.DB.prepare(
      'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC'
    ).bind(sessionId).all()

    const messages = result.results.map((row: any) => JSON.parse(row.content))

    return c.json({
      sessionId,
      messages,
    })
  } catch (error) {
    console.error('Failed to load history:', error)
    return c.json({ error: 'Failed to load history' }, 500)
  }
})

// POST /session/:id/init - Initialize a new session
api.post('/session/:id/init', async (c) => {
  const sessionId = c.req.param('id')

  try {
    // Create session in D1 if it doesn't exist
    const session = await c.env.DB.prepare(
      'SELECT id FROM sessions WHERE id = ?'
    ).bind(sessionId).first()

    if (!session) {
      const now = Date.now()
      await c.env.DB.prepare(
        'INSERT INTO sessions (id, created_at, updated_at, status) VALUES (?, ?, ?, ?)'
      ).bind(sessionId, now, now, 'active').run()
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Failed to initialize session:', error)
    return c.json({ error: 'Failed to initialize session' }, 500)
  }
})

export default api
