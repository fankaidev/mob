/**
 * Browser Gateways for FAST_PROTOTYPE_MODE.
 *
 * Provides gateway implementations that work entirely in the browser:
 * - db: Uses PGLite (WASM PostgreSQL)
 * - auth: Fake auth client (pure TypeScript)
 * - ai: Fake AI client (pure TypeScript)
 * - r2: Fake R2 storage (pure TypeScript)
 */
import type { Gateways, DbClient } from '@backend/infra/gateway'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '@backend/schema'

// Import fake implementations (pure TypeScript, browser-compatible)
import { aiFake } from '@backend/infra/gateway/fake/aiClient'
import { r2Fake } from '@backend/infra/gateway/fake/r2Client'
import { authFake } from '@backend/infra/gateway/fake/authClient'
import { getBrowserPglite } from './browserPglite'

/**
 * Create browser-compatible gateways.
 * These use PGLite for the database and fake implementations for external services.
 */
export function createBrowserGateways(): Gateways {
  return {
    db: {
       
      async createDbClient(_env: unknown): Promise<{ db: DbClient; cleanup: () => Promise<void> }> {
        const client = getBrowserPglite()
        const db = drizzle(client, { schema }) as unknown as DbClient

        return {
          db,
          cleanup: async () => {
            // No cleanup needed - PGLite instance is reused
          },
        }
      },
    },
    auth: {
      fetchAuthService: (...args) => authFake.fetch(...args),
    },
    ai: {
      createClient: () => ({
        chat: (...args) => aiFake.chat(...args),
        generateImage: (...args) => aiFake.generateImage(...args),
      }),
    },
    r2: {
      createClient: () => ({
        upload: (...args) => r2Fake.upload(...args),
        download: (...args) => r2Fake.download(...args),
        delete: (...args) => r2Fake.delete(...args),
      }),
    },
  }
}
