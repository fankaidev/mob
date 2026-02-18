
import type { Logger } from '../middlewares/logger'
import type { FetchWithLog } from '../middlewares/httpLogger'
import type { NeonDatabase, NeonTransaction } from 'drizzle-orm/neon-serverless'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type * as schema from '../schema'
import type { Gateways } from '../infra/gateway'
import type { Fetcher } from '@cloudflare/workers-types'
import type { EnvConfig } from '../infra/env.validation'

/**
 * Bindings type for Cloudflare Workers environment.
 *
 * See infra/env.validation.ts for complete environment variable documentation.
 *
 * This type = EnvConfig (from env.validation.ts) + Service Bindings (Cloudflare-specific).
 */
export type Bindings = EnvConfig & {
  PARAFLOW_SERVICE_AUTH?: {
    fetch: (request: Request) => Promise<Response>
  }
  PARAFLOW_SERVICE_AI_GATEWAY?: Fetcher
  PARAFLOW_SERVICE_R2?: Fetcher
}

export type DbTransaction = NeonTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>



export interface Variables {
  log: Logger
  fetchWithLog: FetchWithLog
  db: NeonDatabase<typeof schema>
  traceId?: string
  gateways: Gateways
  userId: string
}

export type Env = {
  Bindings: Bindings
  Variables: Variables
}
