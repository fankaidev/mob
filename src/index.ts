import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import api from './routes/api'
import admin from './routes/admin'
import slack from './routes/slack'
import web from './routes/web'
import { handleScheduledTrigger } from './scheduled/cron-handler'

const app = new Hono<Env>()

// CORS middleware
app.use('/*', cors({
  origin: ['http://localhost:8787', 'http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  credentials: true,
}))

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Mount API routes
app.route('/api', api)

// Mount Admin routes (should be protected by Cloudflare Access in production)
app.route('/api/admin', admin)

// Mount Slack routes (separate from API for clarity)
app.route('/api/slack', slack)

// Mount web routes
app.route('/', web)

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found', path: c.req.path }, 404)
})

// Error handler
app.onError((err, c) => {
  console.error('Error:', err)
  return c.json({
    error: err.message || 'Internal server error',
  }, 500)
})

export default {
  fetch: app.fetch,

  // Scheduled handler for cron triggers
  scheduled: async (
    event: ScheduledEvent,
    env: Env['Bindings'],
    ctx: ExecutionContext
  ) => {
    ctx.waitUntil(handleScheduledTrigger(env))
  }
}

// Export Durable Object
export { ChatSession } from './durable-objects/ChatSession'
