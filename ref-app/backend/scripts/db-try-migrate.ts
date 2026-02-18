/**
 * Database Try-Migrate Script
 *
 * This script tests migrations locally using PGLite (in-memory PostgreSQL)
 * without needing a real database connection.
 *
 * Usage: pnpm db:try-migrate
 *
 * What it does:
 * 1. Validates journal/snapshot file consistency
 * 2. Creates an in-memory PGLite database
 * 3. Runs all migration SQL files from drizzle/ directory
 * 4. Validates schema.ts tables match migration tables
 * 5. Reports success or failure with detailed error messages
 *
 * Benefits:
 * - No real database needed for development
 * - Fast feedback loop for migration testing
 * - Safe to run repeatedly without cleanup
 * - Catches schema/migration mismatches before deployment
 */

import { PGlite } from '@electric-sql/pglite'
import path from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  validateJournalSnapshotConsistency,
  getDataMigrationGuide,
  getLastJournalIdx,
} from '../src/lib/migrationValidator'
import { is, Table, getTableName } from 'drizzle-orm'
import * as schema from '../src/schema'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface MigrationResult {
  file: string
  success: boolean
  error?: string
  statements: number
}

async function tryMigrate() {
  console.log('🧪 Testing migrations with PGLite (in-memory PostgreSQL)...\n')

  const backendRoot = path.resolve(__dirname, '..')
  const drizzleDir = path.join(backendRoot, 'drizzle')

  // Get all SQL files sorted by name
  let sqlFiles: string[]
  try {
    sqlFiles = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
  } catch (error) {
    console.error('❌ Failed to read drizzle/ directory')
    console.error('   Make sure you have run: pnpm codegen')
    process.exit(1)
  }

  if (sqlFiles.length === 0) {
    console.log('⚠️  No migration files found in drizzle/')
    console.log('   Run: pnpm codegen')
    process.exit(0)
  }

  console.log(`📋 Found ${sqlFiles.length} migration file(s):`)
  sqlFiles.forEach((f) => console.log(`   - ${f}`))
  console.log()

  // Validate journal/snapshot consistency
  console.log('🔍 Validating journal/snapshot consistency...')
  const validation = validateJournalSnapshotConsistency(drizzleDir)
  if (!validation.valid) {
    console.log('\n❌ Journal/Snapshot consistency errors:')
    validation.errors.forEach((err) => console.log(`   - ${err}`))
    const lastIdx = getLastJournalIdx(drizzleDir)
    console.log(getDataMigrationGuide(lastIdx))
    process.exit(1)
  }
  console.log('   ✅ Journal/snapshot files are consistent\n')

  // Create in-memory PGLite database
  const client = new PGlite()
  const results: MigrationResult[] = []

  for (const file of sqlFiles) {
    const filePath = path.join(drizzleDir, file)
    const sql = readFileSync(filePath, 'utf-8')

    // Split by statement breakpoint
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    console.log(`▶️  Running: ${file} (${statements.length} statements)`)

    let success = true
    let errorMessage: string | undefined

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      try {
        await client.exec(stmt)
      } catch (error) {
        success = false
        const err = error as Error
        errorMessage = `Statement ${i + 1}: ${err.message}`

        // Show the failing statement (truncated)
        const preview = stmt.length > 200 ? stmt.substring(0, 200) + '...' : stmt
        console.log(`\n   ❌ Failed at statement ${i + 1}:`)
        console.log(`   ${preview.split('\n').join('\n   ')}`)
        console.log(`\n   Error: ${err.message}`)
        break
      }
    }

    results.push({
      file,
      success,
      error: errorMessage,
      statements: statements.length,
    })

    if (success) {
      console.log(`   ✅ Success`)
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('📊 Migration Test Summary')
  console.log('='.repeat(60))

  const successCount = results.filter((r) => r.success).length
  const failCount = results.filter((r) => !r.success).length
  const totalStatements = results.reduce((sum, r) => sum + r.statements, 0)

  console.log(`   Total files:      ${results.length}`)
  console.log(`   Total statements: ${totalStatements}`)
  console.log(`   Passed:           ${successCount}`)
  console.log(`   Failed:           ${failCount}`)

  if (failCount > 0) {
    console.log('\n❌ Migration test FAILED')
    console.log('\nFailed migrations:')
    results
      .filter((r) => !r.success)
      .forEach((r) => {
        console.log(`   - ${r.file}: ${r.error}`)
      })
    process.exit(1)
  }

  console.log('\n✅ All migrations passed!')

  // Validate schema/migration table consistency
  console.log('\n🔍 Validating schema/migration table consistency...')

  // Get tables defined in schema.ts
  const schemaTables = Object.values(schema)
    .filter((value): value is Table => is(value, Table))
    .map((table) => getTableName(table))
    .sort()

  // Get tables actually created in database (excluding system/internal tables)
  // audit_logs tables are auto-generated by triggers and not defined in schema
  const dbTablesResult = await client.query<{ tablename: string }>(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename NOT LIKE 'drizzle%'
    AND tablename NOT LIKE 'pg_%'
    AND tablename NOT LIKE 'audit_logs%'
    ORDER BY tablename
  `)
  const dbTables = dbTablesResult.rows.map((r) => r.tablename).sort()

  // Find differences
  const inSchemaNotInDb = schemaTables.filter((t) => !dbTables.includes(t))
  const inDbNotInSchema = dbTables.filter((t) => !schemaTables.includes(t))

  if (inSchemaNotInDb.length > 0 || inDbNotInSchema.length > 0) {
    console.log('\n❌ Schema/Migration table mismatch!')

    if (inSchemaNotInDb.length > 0) {
      console.log('\n   Tables in schema.ts but NOT in migrations:')
      inSchemaNotInDb.forEach((t) => console.log(`     - ${t}`))
      console.log('   → Run "pnpm codegen" to create migration for new tables')
    }

    if (inDbNotInSchema.length > 0) {
      console.log('\n   Tables in migrations but NOT in schema.ts:')
      inDbNotInSchema.forEach((t) => console.log(`     - ${t}`))
      console.log('   → Add table definition to schema.ts or remove from migration')
    }

    process.exit(1)
  }

  console.log(`   ✅ Schema and migrations are in sync (${schemaTables.length} tables)`)
  console.log('   Your migration SQL is valid and can be applied to a real database.')
  process.exit(0)
}

tryMigrate().catch((error) => {
  console.error('❌ Unexpected error:', error)
  process.exit(1)
})
