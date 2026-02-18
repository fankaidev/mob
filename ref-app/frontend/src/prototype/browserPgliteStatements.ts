/**
 * Browser PGLite initialization for FAST_PROTOTYPE_MODE.
 *
 * Initializes PGLite in the browser with migration SQL files.
 */
import { migrations } from '@backend/../drizzle/migrations'

let _cachedStatements: string[] | null = null

/**
 * Get SQL statements from migration files (cached).
 */
export function getMigrationStatements(): string[] {
  if (_cachedStatements) {
    return _cachedStatements
  }

  console.log('[Browser PGLite] Loading migration SQL files...')

  const statements: string[] = []

  // Load all migration files in order
  for (const sql of migrations) {
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim()
      if (trimmed) {
        statements.push(trimmed)
      }
    }
  }

  _cachedStatements = statements
  return statements
}
