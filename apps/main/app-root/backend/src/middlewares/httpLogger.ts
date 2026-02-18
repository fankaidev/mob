import * as Sentry from '@sentry/cloudflare'
import { createMiddleware } from 'hono/factory'
import type { Env } from '../types/env'

const CONFIG = {
  excludePaths: ['/health', '/metrics'],
  maxBodyLength: 10000,
  logKind: 'http_log', // event tag, use for search, DO NOT CHANGE
  fingerprint: ['http_log_aggregated'], // groups all HTTP logs into one, DO NOT CHANGE
} as const

function truncateBody(text: string): string {
  return text.length <= CONFIG.maxBodyLength ? text : `[TRUNCATED: ${text.length} bytes]`
}

function getSentryLevel(status: number): 'error' | 'warning' | 'info' {
  if (status >= 500) return 'error'
  if (status >= 400) return 'warning'
  return 'info'
}

async function safeReadBody(reader: () => Promise<string>): Promise<string | undefined> {
  try {
    const text = await reader()
    return text.length > 0 ? truncateBody(text) : undefined
  } catch {
    return 'UNREADABLE'
  }
}

interface HttpLogOptions {
  direction: 'inbound' | 'outbound'
  method: string
  path: string
  status: number
  duration: number
  requestBody?: string
  responseBody?: string
  userId?: string
  errorMessage?: string
}

function captureHttpLog(opts: HttpLogOptions) {
  Sentry.captureMessage(`${opts.method} ${opts.path}`, {
    level: opts.status === 0 ? 'error' : getSentryLevel(opts.status),
    fingerprint: [...CONFIG.fingerprint],
    tags: {
      'kind': CONFIG.logKind,
      'http.direction': opts.direction,
      'http.method': opts.method,
      'http.status_code': opts.status,
      'http.duration_ms': opts.duration,
    },
    // extra info can NOT be placed in query parameters
    extra: {
      'http.method': opts.method,
      'http.route': opts.path,
      'http.status_code': opts.status,
      'http.duration_ms': opts.duration,
      ...(opts.userId && { 'user.id': opts.userId }),
      ...(opts.requestBody && { 'http.request.body': opts.requestBody }),
      ...(opts.responseBody && { 'http.response.body': opts.responseBody }),
      ...(opts.errorMessage && { 'error.message': opts.errorMessage }),
    },
  })
}

export type FetchWithLog = typeof fetch

function createFetchWithLog(enableLogDetail: boolean): FetchWithLog {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method || 'GET'
    const start = Date.now()

    const requestBody =
      enableLogDetail && init?.body
        ? await safeReadBody(async () => (typeof init.body === 'string' ? init.body : String(init.body)))
        : undefined

    try {
      const response = await fetch(input, init)
      const duration = Date.now() - start
      const responseBody = enableLogDetail ? await safeReadBody(() => response.clone().text()) : undefined

      captureHttpLog({
        direction: 'outbound',
        method,
        path: url,
        status: response.status,
        duration,
        requestBody,
        responseBody,
      })
      return response
    } catch (error) {
      captureHttpLog({
        direction: 'outbound',
        method,
        path: url,
        status: 0,
        duration: Date.now() - start,
        requestBody,
        errorMessage: (error as Error).message,
      })
      throw error
    }
  }
}

/**
 * HTTP Logger middleware
 *
 * Uses Sentry to record request/response data
 *
 * 1. Logs inbound API requests with request/response bodies
 * 2. Provides c.var.fetchWithLog for logged outbound HTTP calls
 */
export const httpLoggerMiddleware = createMiddleware<Env>(async (c, next) => {
  const enableLogDetail = c.env.ENABLE_HTTP_LOG_DETAIL === 'true'

  c.set('fetchWithLog', createFetchWithLog(enableLogDetail))

  // Inbound request logging
  const path = c.req.path
  const method = c.req.method

  if (CONFIG.excludePaths.some((p) => path.startsWith(p))) {
    return next()
  }

  // Capture request body before next() consumes it
  const requestBody = enableLogDetail ? await safeReadBody(() => c.req.raw.clone().text()) : undefined

  const start = Date.now()
  await next()
  const duration = Date.now() - start

  const status = c.res?.status ?? 0
  const responseBody = enableLogDetail && c.res ? await safeReadBody(() => c.res.clone().text()) : undefined

  captureHttpLog({
    direction: 'inbound',
    method,
    path,
    status,
    duration,
    requestBody,
    responseBody,
    userId: c.var.userId,
  })
})
