import * as Sentry from '@sentry/react'
import { inIframe } from '../utils/inIframe'

export function initSentry() {
  if (inIframe) {
    return
  }
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'development',
    release: import.meta.env.VITE_SENTRY_RELEASE,
    sendDefaultPii: true,
    ignoreErrors: [],
    tracesSampleRate: 0.5,
    integrations: [Sentry.browserTracingIntegration()],
    enableLogs: true,
    tracePropagationTargets: [
      'localhost',
      /^https:\/\/.*\.paraflow\.cc/,
      /^https:\/\/.*\.paraflow\.com/,
      /^\/api\//,
    ],
  })
}

export function setSentryUser(user: { id: string; email: string; name: string | null } | null) {
  if (inIframe) {
    return
  }
  Sentry.setUser({
    id: user?.id,
    email: user?.email,
    username: user?.name ?? undefined
  })
}

