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

// GET /files/tree - Get file tree visible to a session
api.get('/files/tree', async (c) => {
  try {
    const sessionId = c.req.query('sessionId') || '__shared__'

    // Query files visible to this session:
    // 1. All files from __shared__ session (contains /work and /home)
    // 2. All files from the specific session (contains /tmp and any session-specific files)
    const result = await c.env.DB.prepare(`
      SELECT path, type
      FROM files
      WHERE session_id = '__shared__' OR session_id = ?
      ORDER BY path ASC
    `).bind(sessionId).all()

    // Build tree structure
    interface FileNode {
      name: string
      path: string
      type: 'file' | 'dir'
      children?: FileNode[]
    }

    const root: FileNode[] = []
    const nodeMap = new Map<string, FileNode>()

    // First pass: create all nodes
    for (const row of result.results as any[]) {
      const path = row.path as string
      const type = row.type as 'file' | 'dir'
      const parts = path.split('/').filter(Boolean)
      const name = parts[parts.length - 1] || 'work'

      const node: FileNode = {
        name,
        path,
        type,
        children: type === 'dir' ? [] : undefined,
      }

      nodeMap.set(path, node)
    }

    // Second pass: build tree hierarchy
    for (const row of result.results as any[]) {
      const path = row.path as string
      const node = nodeMap.get(path)!

      const parts = path.split('/').filter(Boolean)

      // Root directories: paths with only one level (e.g., /work, /home, /tmp, etc.)
      if (parts.length === 1) {
        root.push(node)
        continue
      }

      // Find parent path
      const parentParts = parts.slice(0, -1)
      const parentPath = '/' + parentParts.join('/')

      const parent = nodeMap.get(parentPath)
      if (parent && parent.children) {
        parent.children.push(node)
      }
    }

    return c.json({ tree: root })
  } catch (error) {
    console.error('Failed to get file tree:', error)
    return c.json({ error: 'Failed to get file tree' }, 500)
  }
})

// GET /files/content - Get file content
api.get('/files/content', async (c) => {
  try {
    const path = c.req.query('path')
    const sessionId = c.req.query('sessionId') || '__shared__'

    if (!path) {
      return c.json({ error: 'Path is required' }, 400)
    }

    // Determine which session to query based on path
    // /work and /home are always in __shared__, all other paths use the specific session
    const effectiveSessionId = (path.startsWith('/work') || path.startsWith('/home')) ? '__shared__' : sessionId

    const result = await c.env.DB.prepare(
      'SELECT content, type FROM files WHERE session_id = ? AND path = ?'
    ).bind(effectiveSessionId, path).first()

    if (!result) {
      return c.json({ error: 'File not found' }, 404)
    }

    if (result.type !== 'file') {
      return c.json({ error: 'Path is not a file' }, 400)
    }

    return c.json({
      path,
      content: result.content || '',
    })
  } catch (error) {
    console.error('Failed to get file content:', error)
    return c.json({ error: 'Failed to get file content' }, 500)
  }
})

// DELETE /files - Delete file
api.delete('/files', async (c) => {
  try {
    const path = c.req.query('path')
    const sessionId = c.req.query('sessionId') || '__shared__'

    if (!path) {
      return c.json({ error: 'Path is required' }, 400)
    }

    // Determine which session to delete from based on path
    // /work and /home are always in __shared__, all other paths use the specific session
    const effectiveSessionId = (path.startsWith('/work') || path.startsWith('/home')) ? '__shared__' : sessionId

    // Delete the file
    const result = await c.env.DB.prepare(
      'DELETE FROM files WHERE session_id = ? AND path = ?'
    ).bind(effectiveSessionId, path).run()

    if (result.meta.changes === 0) {
      return c.json({ error: 'File not found' }, 404)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Failed to delete file:', error)
    return c.json({ error: 'Failed to delete file' }, 500)
  }
})

export default api
