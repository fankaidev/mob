import type { DbClient } from '../production/db'

/**
 * Fake implementation of createDbClient using PGlite for tests.
 *
 * Simulates production Neon/pg-pool behavior: after cleanup() (i.e. pool.end()),
 * any db access throws "Cannot use a pool after calling end on the pool".
 *
 * This ensures test behavior matches production, catching bugs like using
 * c.var.db in waitUntil() callbacks after middleware cleanup.
 */

let currentTestId: string = 'default-test'

export const dbFake = {
  reset(testId: string) {
    currentTestId = testId
  },

  async createDbClient(_env: unknown): Promise<{ db: DbClient; cleanup: () => Promise<void> }> {
    const { drizzle } = await import('drizzle-orm/pglite')
    const { schema } = await import('../production/db')
    const { getPgliteClientForTest } = await import('./testInfra')

    const client = await getPgliteClientForTest(currentTestId)
    const realDb = drizzle(client, { schema }) as unknown as DbClient

    let ended = false

    const db = new Proxy(realDb, {
      get(target, prop, receiver) {
        if (ended) {
          throw new Error(`Cannot use a pool after calling end on the pool (accessed: db.${String(prop)})`)
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    return {
      db: db as DbClient,
      cleanup: async () => {
        ended = true
      },
    }
  },
}
