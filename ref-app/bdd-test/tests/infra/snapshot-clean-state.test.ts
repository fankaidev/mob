import { describe, it, expect } from 'vitest'
import { getPgliteClientForTest } from '@backend/infra/gateway/fake'

const getTestFileId = (): string => {
  const testPath = expect.getState().testPath
  if (!testPath) {
    return expect.getState().currentTestName || 'unknown'
  }
  return testPath.replace(/^.*\/tests\//, 'tests/')
}

describe('Snapshot clean state', () => {
  it('starts with empty tables after reset', async () => {
    const testId = getTestFileId()
    const client = await getPgliteClientForTest(testId)

    const allTables = await client.query<{ tablename: string }>(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `)

    const tableNames = allTables.rows.map(r => r.tablename)
    const hasUsersTable = tableNames.includes('users')

    // When users table exists, beforeEach seeds users which also populates
    // audit_logs via triggers. These tables are checked with exact assertions below.
    const isPopulatedByBeforeEach = (name: string): boolean =>
      hasUsersTable && (name === 'users' || name.startsWith('audit_logs'))

    for (const { tablename } of allTables.rows) {
      if (isPopulatedByBeforeEach(tablename)) continue

      const { rows } = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM "${tablename}"`
      )
      expect(rows[0]?.count, `table "${tablename}" should be empty`).toBe(0)
    }

    if (hasUsersTable) {
      // users: exactly 3 rows from beforeEach (admin seed + regular-a + regular-b).
      // A count other than 3 means the snapshot leaked user data.
      const userCount = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM users`
      )
      expect(userCount.rows[0]?.count).toBe(3)

      // audit_logs: all entries must originate from user operations only.
      // If the snapshot leaked data for other tables, those table names would appear here.
      const auditSources = await client.query<{ table_name: string }>(`
        SELECT DISTINCT table_name FROM audit_logs ORDER BY table_name
      `)
      expect(auditSources.rows.map(r => r.table_name)).toEqual(['users'])
    }
  })
})
