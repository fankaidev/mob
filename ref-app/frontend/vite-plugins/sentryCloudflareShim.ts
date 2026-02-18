/**
 * Shim for @sentry/cloudflare in FAST_PROTOTYPE_MODE.
 *
 * Re-exports @sentry/react (browser-compatible) and provides
 * no-op implementations for Cloudflare Workers specific APIs.
 */
export * from '@sentry/react'

// No-op withSentry for browser - just returns the handler unchanged
// In Cloudflare Workers, this wraps the handler with Sentry instrumentation
// In browser prototype mode, we skip this wrapping
export function withSentry<T>(_options: unknown, handler: T): T {
  return handler
}

// No-op honoIntegration for browser
// In Cloudflare Workers, this provides Hono framework instrumentation
export function honoIntegration() {
  return {
    name: 'hono-noop',
  }
}

// Type alias for CloudflareOptions (use BrowserOptions from @sentry/react as base)
import type { BrowserOptions } from '@sentry/react'
export type CloudflareOptions = BrowserOptions & {
  enableLogs?: boolean
}
