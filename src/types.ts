import type { DurableObjectNamespace } from '@cloudflare/workers-types'

export interface Env {
  Bindings: {
    DB: D1Database
    CHAT_SESSION: DurableObjectNamespace
  }
}
