import { HTTPException } from 'hono/http-exception'
import type { ErrorHandler } from 'hono'
import type { Env } from '../types/env'
import { Sentry } from '../lib/sentry'
import { logger } from './logger'

/**
 * Global error handler middleware
 *
 * Handles:
 * - HTTPException (4xx/5xx errors)
 * - Unknown errors (treated as 500)
 * - Sentry error reporting
 */
export const errorHandler: ErrorHandler<Env> = (err, c) => {
  const user = Reflect.get(c.var, 'user')
  if (user) {
    Sentry.setUser({ id: user.id, email: user.email, username: user.name ?? undefined })
  }
  Sentry.captureException(err)

  const method = c.req.method
  const url = c.req.url
  const query = c.req.query()

  if (err instanceof HTTPException) {
    // Only log 5xx server errors, not 4xx client errors
    if (err.status >= 500) {
      logger.error('Request failed', { method, url, query, error: err.message, stack: err.stack })
    }
    return c.json({ message: err.message }, err.status)
  }
  // Unknown errors are treated as 500, always log
  logger.error('Request failed', { method, url, query, error: err.message, stack: err.stack, cause: err.cause })

  return c.json({ message: 'Internal server error' }, 500)
}
