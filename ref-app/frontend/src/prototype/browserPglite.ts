/**
 * Browser PGLite initialization for FAST_PROTOTYPE_MODE.
 *
 * Initializes PGLite in the browser with:
 * 1. Infrastructure SQL (audit logs, trigger functions)
 * 2. SQL generated directly from schema.ts (browser-compatible)
 * 3. Audit triggers for all tables
 * 4. Test users seeded for development
 */
import { PGlite } from '@electric-sql/pglite'
import { getMigrationStatements } from './browserPgliteStatements'

let _pgliteInstance: PGlite | null = null

export function getBrowserPglite() {
  if (!_pgliteInstance) {
    throw Error("pglite instance is not initialized")
  }
  return _pgliteInstance
}

/**
 * create the singleton PGLite instance for the browser.
 */
export async function initBrowserPglite(): Promise<PGlite> {
  if (_pgliteInstance) {
    return _pgliteInstance
  }

  console.log('[Browser PGLite] Initializing database...')

  const client = new PGlite()
  await client.waitReady

  // Get SQL statements
  const sqlStatements = getMigrationStatements()

  // Execute all SQL statements
  console.log(`[Browser PGLite] Executing ${sqlStatements.length} SQL statements...`)
  for (const stmt of sqlStatements) {
    try {
      await client.exec(stmt)
    } catch (e) {
      console.error('[Browser PGLite] SQL execution error:', e)
      console.error('[Browser PGLite] Failed statement:', stmt.substring(0, 200))
      throw e
    }
  }

  console.log('[Browser PGLite] Database ready!')
  _pgliteInstance = client
  return client
}

/**
 * Reset the database to initial state (for development/testing).
 */
export async function resetBrowserPglite(): Promise<void> {
  if (_pgliteInstance) {
    await _pgliteInstance.close()
    _pgliteInstance = null
  }
}
