/**
 * Custom Database Migration Generator
 *
 * This script generates migration files with detailed diff comments
 * for manual SQL writing.
 *
 * Usage:
 *   pnpm codegen                 # Generate migration for schema changes
 *   pnpm codegen --new-migration # Force create a new migration (for seed data, etc.)
 *
 * What it does:
 * 1. Detects audit capability for each table (checks for audit fields with correct types)
 * 2. Reads current schema from schema.ts
 * 3. Generates a new snapshot
 * 4. Compares with the previous snapshot
 * 5. Creates a .sql file with diff comments for manual implementation
 * 6. Only generates audit triggers for tables with proper audit fields
 */

import * as schema from '../src/schema'
import { generateMigration, type AuditCapability } from '../codegen-tpl/migration-sql'
import { is } from 'drizzle-orm'
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core'

/**
 * Detects audit capability for each table based on column presence and types.
 *
 * Trigger functions in 0000_audit_logs.sql require these columns:
 * - audit_before_trigger(): created_at (timestamp), updated_at (timestamp), created_by (uuid), updated_by (uuid)
 * - audit_before_insert_only_trigger(): created_at (timestamp), created_by (uuid)
 * - audit_after_trigger(): id (for record_id in audit_logs)
 *
 * Returns a map of table names to their audit capability:
 * - 'full': has all 4 audit fields with correct types (supports INSERT and UPDATE)
 * - 'insert-only': has created_by and created_at with correct types (INSERT only)
 * - 'none': missing required fields or incorrect types (no audit triggers)
 */
function detectAuditCapabilities(schemaObj: Record<string, unknown>): Map<string, AuditCapability> {
  console.log('🔍 Detecting audit capabilities...\n')

  const capabilities = new Map<string, AuditCapability>()

  for (const [key, value] of Object.entries(schemaObj)) {
    // Skip non-table exports (enums, types, etc.)
    if (!is(value, PgTable)) {
      continue
    }

    const tableConfig = getTableConfig(value)
    const tableName = tableConfig.name
    const columns = new Map(tableConfig.columns.map((col) => [col.name, col]))

    // Check for id column (required by audit_after_trigger)
    const idCol = columns.get('id')
    if (!idCol) {
      capabilities.set(tableName, 'none')
      continue
    }

    // Check all 4 audit fields
    const createdByCol = columns.get('created_by')
    const createdAtCol = columns.get('created_at')
    const updatedByCol = columns.get('updated_by')
    const updatedAtCol = columns.get('updated_at')

    const hasValidCreatedBy = createdByCol && createdByCol.columnType === 'PgUUID'
    const hasValidCreatedAt = createdAtCol && createdAtCol.columnType === 'PgTimestamp'
    const hasValidUpdatedBy = updatedByCol && updatedByCol.columnType === 'PgUUID'
    const hasValidUpdatedAt = updatedAtCol && updatedAtCol.columnType === 'PgTimestamp'

    // Full audit: all 4 fields must exist with correct types
    if (hasValidCreatedBy && hasValidCreatedAt && hasValidUpdatedBy && hasValidUpdatedAt) {
      capabilities.set(tableName, 'full')
    }
    // Insert-only audit: exactly created_by and created_at with correct types, no updated fields
    else if (hasValidCreatedBy && hasValidCreatedAt && !updatedByCol && !updatedAtCol) {
      capabilities.set(tableName, 'insert-only')
    }
    // All other cases: skip audit
    else {
      capabilities.set(tableName, 'none')
    }
  }

  // Report audit capabilities summary
  const fullTables = [...capabilities.entries()].filter(([_, cap]) => cap === 'full').map(([name]) => name)
  const insertOnlyTables = [...capabilities.entries()].filter(([_, cap]) => cap === 'insert-only').map(([name]) => name)
  const skippedTables = [...capabilities.entries()].filter(([_, cap]) => cap === 'none').map(([name]) => name)

  if (fullTables.length > 0) {
    console.log(`   ✅ Audit (INSERT/UPDATE): ${fullTables.join(', ')}`)
  }
  if (insertOnlyTables.length > 0) {
    console.log(`   ✅ Audit (INSERT only): ${insertOnlyTables.join(', ')}`)
  }
  if (skippedTables.length > 0) {
    console.log(`   ⏭️  Skip audit: ${skippedTables.join(', ')}`)
  }
  console.log('')

  return capabilities
}

async function run() {
  const auditCapabilities = detectAuditCapabilities(schema)
  const newMigration = process.argv.includes('--new-migration')
  await generateMigration(schema, { newMigration, auditCapabilities })
}

run().catch((err: unknown) => {
  console.error('❌ Error:', err)
  throw err
})
