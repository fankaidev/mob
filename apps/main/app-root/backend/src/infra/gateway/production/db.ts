import { drizzle, NeonDatabase, NeonTransaction } from 'drizzle-orm/neon-serverless'
import { Pool } from '@neondatabase/serverless'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import * as schema from '../../../schema'
import type { Bindings } from '../../../types/env'

export type DbClient = NeonDatabase<typeof schema>
export type DbTransaction = NeonTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>

// Singleton pool+db for browser environment.
// In browser server mode (long-lived process), we reuse the same pool to avoid
// repeated WebSocket handshake + PG auth overhead on every request.
// max: 1 ensures set_config audit context stays on the same connection.
let browserPool: Pool | null = null
let browserDb: DbClient | null = null

function isBrowser(): boolean {
  return typeof globalThis !== 'undefined' && 'window' in globalThis
}

/**
 * Creates a database connection from environment bindings.
 * Use this for non-HTTP contexts like scheduled handlers.
 * Returns both the db client and pool for cleanup.
 */
export function createDbFromEnv(env: Bindings): { db: DbClient; pool: Pool } {
  const pool = new Pool({ connectionString: env.PARAFLOW_DRIZZLE_URL })
  const db = drizzle(pool, { schema })
  return { db, pool }
}

/**
 * Gateway function: Create database client for HTTP request context.
 * This is the mockable entry point for tests.
 *
 * Returns a cleanup function that should be called after the request completes.
 *
 * Note: Made async to support test mocks that need async initialization (PGlite).
 * In production, this resolves immediately.
 *
 * In browser environment, db and pool are created once and reused across all requests.
 * In Cloudflare Workers, a new Pool is created per request and destroyed after.
 */
export async function createDbClient(env: Bindings): Promise<{ db: DbClient; cleanup: () => Promise<void> }> {
  // Browser environment: reuse singleton pool+db
  if (isBrowser()) {
    if (!browserPool || !browserDb) {
      browserPool = new Pool({ connectionString: env.PARAFLOW_DRIZZLE_URL, max: 1 })
      browserDb = drizzle(browserPool, { schema })
    }
    return {
      db: browserDb,
      cleanup: async () => {}, // no-op — pool is persistent in browser
    }
  }

  // Non-browser environment (Cloudflare Workers): create new pool per request
  const { db, pool } = createDbFromEnv(env)
  return {
    db,
    cleanup: async () => {
      await pool.end()
    }
  }
}

export { schema }
