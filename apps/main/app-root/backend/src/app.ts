
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getSentryOptions } from './lib/sentry'
import { registerHelpers } from './lib/renderer'
import { loggerMiddleware, logger } from './middlewares/logger'
import { httpLoggerMiddleware } from './middlewares/httpLogger'
import { gatewayMiddleware, createGatewayMiddleware } from './middlewares/gateway'
import { dbMiddleware } from './middlewares/db'
import { errorHandler } from './middlewares/error'
import type { Env, Bindings } from './types/env'
import type { Gateways } from './infra/gateway'
import { withSentry } from '@sentry/cloudflare'
import type { ExportedHandlerScheduledHandler } from '@cloudflare/workers-types'
import { agentApi } from './api/agent'
import { fileExplorerRoutes } from './api/stores/FileExplorerStore'
import { slackApi } from './api/slack'

function registerRoutes(app: Hono<Env>) {
  app.route('/api/agent', agentApi)
  app.route('/api/FileExplorerStore', fileExplorerRoutes)
  app.route('/api/slack', slackApi)
}

/**
 * Create the Hono application with all routes and middleware.
 *
 * Each API module exports its own type for Hono RPC.
 * Frontend imports only the API clients it needs.
 *
 * @param gateways - Optional custom gateways for testing. Uses production gateways by default.
 */
export function createApp(gateways?: Gateways) {

  const app = new Hono<Env>()

  // Register Handlebars helpers
  registerHelpers()

  // Logger middleware
  app.use('*', loggerMiddleware())

  // HTTP logger middleware (logs inbound requests and provides c.var.fetchWithLog)
  app.use('*', httpLoggerMiddleware)

  // Gateway middleware - inject gateway implementations (production or test)
  app.use('*', gateways ? createGatewayMiddleware(gateways) : gatewayMiddleware)

  // CORS middleware
  app.use('/*', cors({
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'sentry-trace', 'baggage'],
    credentials: true,
  }))

  app.use('/api/*', dbMiddleware)


  registerRoutes(app)

  // Error handlers (after all routes so fallbacks are clear)
  // Use a specific marker for unregistered routes, so tests can distinguish from business 404s
  app.notFound((c) => c.json({ error: 'HONO_ROUTE_NOT_FOUND', path: c.req.path }, 404))
  app.onError(errorHandler)

  return app
}

// Create the production app instance
const app = createApp()

// Scheduled handler for cron jobs
const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (_event, env, ctx) => {
  logger.info(`Cron job triggered at ${new Date().toISOString()}`)



}


export default withSentry<Bindings>(
  (env) => getSentryOptions(env),
  {
    fetch: app.fetch,
    scheduled,
  }
)
