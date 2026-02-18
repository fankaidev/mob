/**
 * Fake Gateways
 *
 * Provides fake implementations for all gateway interfaces.
 * These replace the production gateways in tests via Hono context injection.
 *
 * Note: Error classes (AIError, R2Error) are NOT swapped - they're imported
 * directly from production code where needed.
 */
import type { Gateways } from '../index'
import { aiFake } from './aiClient'
import { r2Fake } from './r2Client'
import { authFake } from './authClient'
import { dbFake } from './dbClient'

export const fakeGateways: Gateways = {
  db: {
    createDbClient: (...args) => dbFake.createDbClient(...args),
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

// Re-export fakes for test reset in beforeEach
export { aiFake, r2Fake, authFake, dbFake }

// Re-export test infrastructure
export { getPgliteClientForTest, resetDatabaseForTest } from './testInfra'
