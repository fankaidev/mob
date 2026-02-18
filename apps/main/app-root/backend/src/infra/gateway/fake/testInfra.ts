import { PGlite } from '@electric-sql/pglite'
import path from 'node:path'
import {
  validateJournalSnapshotConsistency,
  getDataMigrationGuide,
  getLastJournalIdx,
} from '../../../lib/migrationValidator'
import { migrations } from '../../../../drizzle/migrations'

const _dbInst = new Map<string, Promise<PGlite>>()

// Global snapshot of database after migration (shared across all test files)
let _globalSnapshot: Blob | null = null

// __dirname in Vite test environment points to backend/src/infra/gateway/testing
// Navigate up to backend root
const BACKEND_ROOT = path.join(__dirname, '..', '..', '..', '..')
const DRIZZLE_DIR = path.join(BACKEND_ROOT, 'drizzle')

/**
 * Load all SQL migration files and validate consistency.
 * Only called once when building the first global snapshot.
 */
function getMigrationSQL(): string {
    const validation = validateJournalSnapshotConsistency(DRIZZLE_DIR)
    if (!validation.valid) {
        const lastIdx = getLastJournalIdx(DRIZZLE_DIR)
        const errorMsg = [
            '',
            '❌ Migration file consistency check failed!',
            '',
            'Errors:',
            ...validation.errors.map((e) => `  - ${e}`),
            '',
            getDataMigrationGuide(lastIdx),
        ].join('\n')
        throw new Error(errorMsg)
    }
    return migrations.join('\n')
}

async function truncateAllTablesForSnapshot(client: PGlite): Promise<void> {
  const { rows } = await client.query<{ tablename: string }>(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  `)

  for (const { tablename } of rows) {
    // Table names come from pg_tables under public schema.
    // Quote identifiers to keep SQL safe for mixed-case names.
    await client.exec(`TRUNCATE TABLE "${tablename}" RESTART IDENTITY CASCADE`)
  }
}

export const getPgliteClientForTest = (testId: string) => {
  if (_dbInst.has(testId)) {
    return _dbInst.get(testId)!
  }
  const f = async () => {
    // If we have a global snapshot, restore from it (fast path)
    if (_globalSnapshot) {
      const client = new PGlite({ loadDataDir: _globalSnapshot })
      await client.waitReady
      // Ensure database is fully ready by running a test query
      await client.query('SELECT 1')
      return client
    }

    // First time: run migrations and save global snapshot
    const client = new PGlite()
    await client.waitReady

    // Get statements to execute
    const sql = getMigrationSQL()
    const statements = sql.split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(s => s.length > 0)

    // Execute each statement
    for (const stmt of statements) {
      await client.exec(stmt)
    }

    // Build a clean snapshot: schema exists, all data removed.
    await truncateAllTablesForSnapshot(client)

    // Save global snapshot after preparing clean database
    // jsdom's File/Blob doesn't have arrayBuffer(), extract internal buffer
    const dumpedFile = await client.dumpDataDir()
    const symbols = Object.getOwnPropertySymbols(dumpedFile)
    // @ts-expect-error accessing internal jsdom implementation
    const impl = dumpedFile[symbols[0]]
    const buffer = impl._buffer as Buffer

    // Create Node.js native Blob with arrayBuffer() support
    const { Blob: NodeBlob } = await import('buffer')
    _globalSnapshot = new NodeBlob([buffer], { type: dumpedFile.type }) as unknown as Blob

    return client
  }
  const res = f()
  _dbInst.set(testId, res)
  return res
}

/**
 * Reset database state for a test.
 * Truncates all public tables to restore clean state, reusing the existing
 * PGlite instance instead of destroying and recreating from snapshot.
 *
 * This avoids the expensive `new PGlite({ loadDataDir })` + `waitReady`
 * cycle (~1.4-1.9s per call). TRUNCATE on the existing client is near-instant.
 *
 * This enables file-level DB sharing: all tests in a file use
 * the same database, but each test starts from an empty dataset.
 */
export async function resetDatabaseForTest(testId: string) {
  // Only reset if DB already exists (avoid creating unnecessary instances)
  if (!_dbInst.has(testId)) {
    return
  }

  // Reuse existing client — truncate tables instead of recreating from snapshot.
  const client = await _dbInst.get(testId)!
  await truncateAllTablesForSnapshot(client)
}
