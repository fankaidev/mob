import * as Sentry from '@sentry/cloudflare'
import { honoIntegration } from '@sentry/cloudflare'
import type { CloudflareOptions } from '@sentry/cloudflare'
import type { Bindings } from '../types/env'

export { Sentry }

export function getSentryOptions(env: Bindings): CloudflareOptions {
  const dsn = env?.PARAFLOW_SENTRY_DSN
  if (!dsn?.startsWith('https://')) {
    return { dsn: '' }
  }

  return {
    dsn,
    environment: env?.PARAFLOW_SENTRY_ENVIRONMENT || 'development',
    release: env?.PARAFLOW_SENTRY_RELEASE,
    tracesSampleRate: 1.0,
    enableLogs: true,
    integrations: [honoIntegration()],
  }
}

