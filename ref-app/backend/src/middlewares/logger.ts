import type { MiddlewareHandler } from 'hono'
import * as Sentry from '@sentry/cloudflare'

type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'fatal'

export type Logger = {
  debug: (message: string, extra?: Record<string, unknown>) => void
  info: (message: string, extra?: Record<string, unknown>) => void
  warn: (message: string, extra?: Record<string, unknown>) => void
  error: (message: string, extra?: Record<string, unknown>) => void
  fatal: (message: string, extra?: Record<string, unknown>) => void
}

function logFn(level: LogLevel, message: string, extra?: Record<string, unknown>) {
  // Log to console
  if (level === 'debug') {
    console.log(`[DEBUG]`, message, extra || '')
  } else if (level === 'info') {
    console.info(`[INFO]`, message, extra || '')
  } else if (level === 'warning') {
    console.warn(`[WARN]`, message, extra || '')
  } else {
    console.error(`[${level.toUpperCase()}]`, message, extra || '')
  }

  // Add breadcrumb for tracing
  Sentry.addBreadcrumb({
    category: 'log',
    message,
    level,
    data: extra,
  })

  // Report error/fatal as exception
  if (level === 'error' || level === 'fatal') {
    if (extra) {
      Sentry.setExtras(extra)
    }
    const error = extra?.error instanceof Error
      ? extra.error
      : new Error(message)
    Sentry.captureException(error)
  }

  // Report info/warning as message
  if (level === 'info' || level === 'warning') {
    if (extra) {
      Sentry.setExtras(extra)
    }
    Sentry.captureMessage(message)
  }
}

/**
 * Logger instance for use anywhere in the codebase.
 *
 * Usage:
 *   import { logger } from './middlewares/logger'
 *   logger.info('Task started', { taskId: '123' })
 *
 * In Hono routes, prefer using c.var.log for consistency:
 *   const { log } = c.var
 *   log.info('User logged in', { userId: '123' })
 */
export const logger: Logger = {
  debug: (message, extra) => logFn('debug', message, extra),
  info: (message, extra) => logFn('info', message, extra),
  warn: (message, extra) => logFn('warning', message, extra),
  error: (message, extra) => logFn('error', message, extra),
  fatal: (message, extra) => logFn('fatal', message, extra),
}

/**
 * Logger middleware - injects logger into Hono context
 */
export const loggerMiddleware = (): MiddlewareHandler<{ Variables: { log: Logger } }> => {
  return async (c, next) => {
    c.set('log', logger)
    await next()
  }
}
