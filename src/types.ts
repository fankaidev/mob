import type { DurableObjectNamespace, Queue } from '@cloudflare/workers-types'

export interface Env {
  Bindings: {
    DB: D1Database
    CHAT_SESSION: DurableObjectNamespace
    TASK_EXECUTOR: DurableObjectNamespace
    SLACK_QUEUE: Queue
  }
}
