/**
 * Schema-Migration Consistency Validator
 *
 * Validates that schema.ts and migration SQL files are in sync.
 * Compares the expected database structure (from schema.ts) with
 * the actual structure (from PGLite after running migrations).
 *
 * This catches cases where developers modify schema.ts but forget
 * to run `pnpm codegen` and update the migration SQL.
 */

import type { PGlite } from '@electric-sql/pglite'
import { generateDrizzleJson } from './drizzle-kit-browser'
import type { PgSchemaInternal } from './drizzle-kit-browser/types'

// Tables managed by infrastructure (0000_audit_logs.sql), not in schema.ts
// Also includes partition patterns (audit_logs_YYYY_MM)
const INFRASTRUCTURE_TABLES = ['audit_logs']
const INFRASTRUCTURE_TABLE_PATTERNS = [/^audit_logs_\d{4}_\d{2}$/]

// Normalize PostgreSQL type for comparison
// - Handles type aliases (int4 -> integer, int8 -> bigint)
// - Handles array notation consistency
// - Normalizes spacing in parameterized types (numeric(12, 2) -> numeric(12,2))
function normalizeType(type: string): string {
  let normalized = type.toLowerCase().trim()

  // Handle array types first
  const isArray = normalized.includes('[]')
  if (isArray) {
    normalized = normalized.replace(/\[\]/g, '')
  }

  // Normalize spacing in parameterized types like numeric(12, 2) -> numeric(12,2)
  // This handles the difference between PostgreSQL's format_type() output and Drizzle's getSQLType()
  normalized = normalized.replace(/\(\s*/g, '(').replace(/\s*,\s*/g, ',').replace(/\s*\)/g, ')')

  // Normalize common type aliases
  const typeAliases: Record<string, string> = {
    'int': 'integer',
    'int4': 'integer',
    'int8': 'bigint',
    'int2': 'smallint',
    'float4': 'real',
    'float8': 'double precision',
    'bool': 'boolean',
    'serial': 'integer',
    'smallserial': 'smallint',
    'bigserial': 'bigint',
    'decimal': 'numeric',
    'bpchar': 'char',
    'timestamp': 'timestamp without time zone',
    'timestamptz': 'timestamp with time zone',
    'timetz': 'time with time zone',
    'varchar': 'character varying',
    'char': 'character',
  }

  // Apply alias normalization
  for (const [alias, canonical] of Object.entries(typeAliases)) {
    if (normalized === alias) {
      normalized = canonical
      break
    }
  }

  // Re-add array suffix if needed
  if (isArray) {
    normalized += '[]'
  }

  return normalized
}

interface SchemaDiff {
  type: 'missing_table' | 'extra_table' | 'missing_column' | 'extra_column' |
        'column_type_mismatch' | 'column_nullable_mismatch' | 'missing_index' |
        'missing_foreign_key' | 'missing_enum' | 'enum_values_mismatch'
  table?: string
  column?: string
  index?: string
  foreignKey?: string
  enum?: string
  expected?: string
  actual?: string
}

interface ForeignKeyInfo {
  constraintName: string
  fromColumns: string[]
  toTable: string
  toColumns: string[]
}

interface DatabaseIntrospection {
  tables: Map<string, {
    columns: Map<string, { type: string; nullable: boolean }>
    indexes: Set<string>
    foreignKeys: ForeignKeyInfo[]
  }>
  enums: Map<string, string[]>
}

/**
 * Query PostgreSQL information_schema to get actual database structure
 */
async function introspectDatabase(client: PGlite): Promise<DatabaseIntrospection> {
  const result: DatabaseIntrospection = {
    tables: new Map(),
    enums: new Map(),
  }

  // Get all tables
  const tablesResult = await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `)

  for (const row of tablesResult.rows) {
    const tableName = row.table_name
    // Skip infrastructure tables and their partitions
    if (INFRASTRUCTURE_TABLES.includes(tableName)) {
      continue
    }
    if (INFRASTRUCTURE_TABLE_PATTERNS.some(pattern => pattern.test(tableName))) {
      continue
    }

    result.tables.set(tableName, {
      columns: new Map(),
      indexes: new Set(),
      foreignKeys: [],
    })
  }

  // Get all columns using pg_catalog and format_type for accurate type strings
  // This approach follows drizzle-kit's pattern in pgSerializer.ts
  const columnsResult = await client.query<{
    table_name: string
    column_name: string
    data_type: string // Full type from format_type (e.g., 'character varying(200)')
    array_dimensions: number
    additional_dt: string // Data type from information_schema
    enum_name: string // udt_name for user-defined types
    is_nullable: string
  }>(`
    SELECT
      cls.relname AS table_name,
      a.attname AS column_name,
      format_type(a.atttypid, a.atttypmod) AS data_type,
      a.attndims AS array_dimensions,
      c.data_type AS additional_dt,
      c.udt_name AS enum_name,
      CASE
        WHEN a.attnotnull THEN 'NO'
        ELSE 'YES'
      END AS is_nullable
    FROM
      pg_attribute a
    JOIN
      pg_class cls ON cls.oid = a.attrelid
    JOIN
      pg_namespace ns ON ns.oid = cls.relnamespace
    LEFT JOIN
      information_schema.columns c ON c.column_name = a.attname
        AND c.table_schema = ns.nspname
        AND c.table_name = cls.relname
    WHERE
      a.attnum > 0
      AND NOT a.attisdropped
      AND cls.relkind = 'r'
      AND ns.nspname = 'public'
    ORDER BY
      cls.relname, a.attnum
  `)

  for (const row of columnsResult.rows) {
    const tableInfo = result.tables.get(row.table_name)
    if (!tableInfo) continue

    // Start with the full type from format_type
    let type = row.data_type

    // Handle ARRAY types - add additional dimensions
    if (row.additional_dt === 'ARRAY' && row.array_dimensions > 1) {
      for (let i = 1; i < row.array_dimensions; i++) {
        type += '[]'
      }
    }

    // Handle user-defined types (enums)
    if (row.additional_dt === 'USER-DEFINED') {
      type = row.enum_name
    } else {
      // Normalize type names to match drizzle schema conventions
      // Following drizzle-kit's pattern from pgSerializer.ts
      type = type
        .replace('character varying', 'varchar')
        .replace(' without time zone', '')
        .replace('character', 'char')
    }

    tableInfo.columns.set(row.column_name, {
      type,
      nullable: row.is_nullable === 'YES',
    })
  }

  // Get all indexes (excluding primary key indexes which are implicit)
  const indexesResult = await client.query<{
    tablename: string
    indexname: string
  }>(`
    SELECT
      tablename,
      indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname NOT LIKE '%_pkey'
  `)

  for (const row of indexesResult.rows) {
    const tableInfo = result.tables.get(row.tablename)
    if (tableInfo) {
      tableInfo.indexes.add(row.indexname)
    }
  }

  // Get all foreign keys with column details
  const fkResult = await client.query<{
    table_name: string
    constraint_name: string
    column_name: string
    foreign_table_name: string
    foreign_column_name: string
  }>(`
    SELECT
      kcu.table_name,
      kcu.constraint_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.key_column_usage kcu
    JOIN information_schema.table_constraints tc
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY kcu.table_name, kcu.constraint_name, kcu.ordinal_position
  `)

  // Group FK columns by constraint name
  const fkGroups = new Map<string, {
    tableName: string
    constraintName: string
    fromColumns: string[]
    toTable: string
    toColumns: string[]
  }>()

  for (const row of fkResult.rows) {
    const key = `${row.table_name}.${row.constraint_name}`
    const existing = fkGroups.get(key)
    if (existing) {
      existing.fromColumns.push(row.column_name)
      existing.toColumns.push(row.foreign_column_name)
    } else {
      fkGroups.set(key, {
        tableName: row.table_name,
        constraintName: row.constraint_name,
        fromColumns: [row.column_name],
        toTable: row.foreign_table_name,
        toColumns: [row.foreign_column_name],
      })
    }
  }

  // Add to table info
  for (const fk of fkGroups.values()) {
    const tableInfo = result.tables.get(fk.tableName)
    if (tableInfo) {
      tableInfo.foreignKeys.push({
        constraintName: fk.constraintName,
        fromColumns: fk.fromColumns,
        toTable: fk.toTable,
        toColumns: fk.toColumns,
      })
    }
  }

  // Get all enums
  const enumsResult = await client.query<{
    enum_name: string
    enum_value: string
  }>(`
    SELECT
      t.typname AS enum_name,
      e.enumlabel AS enum_value
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder
  `)

  for (const row of enumsResult.rows) {
    const existing = result.enums.get(row.enum_name) || []
    existing.push(row.enum_value)
    result.enums.set(row.enum_name, existing)
  }

  return result
}

/**
 * Compare expected schema (from schema.ts) with actual database structure
 */
function compareSchemas(
  expected: PgSchemaInternal,
  actual: DatabaseIntrospection
): SchemaDiff[] {
  const diffs: SchemaDiff[] = []

  // Compare enums
  for (const enumDef of Object.values(expected.enums)) {
    const actualValues = actual.enums.get(enumDef.name)
    if (!actualValues) {
      diffs.push({
        type: 'missing_enum',
        enum: enumDef.name,
        expected: enumDef.values.join(', '),
      })
    } else {
      // Check enum values match
      const expectedSorted = [...enumDef.values].sort()
      const actualSorted = [...actualValues].sort()
      if (JSON.stringify(expectedSorted) !== JSON.stringify(actualSorted)) {
        diffs.push({
          type: 'enum_values_mismatch',
          enum: enumDef.name,
          expected: enumDef.values.join(', '),
          actual: actualValues.join(', '),
        })
      }
    }
  }

  // Compare tables
  for (const tableDef of Object.values(expected.tables)) {
    const tableName = tableDef.name
    const actualTable = actual.tables.get(tableName)

    if (!actualTable) {
      diffs.push({
        type: 'missing_table',
        table: tableName,
      })
      continue
    }

    // Compare columns
    for (const [colName, colDef] of Object.entries(tableDef.columns)) {
      const actualCol = actualTable.columns.get(colName)

      if (!actualCol) {
        diffs.push({
          type: 'missing_column',
          table: tableName,
          column: colName,
          expected: colDef.type,
        })
        continue
      }

      // Compare type (normalized)
      const expectedType = normalizeType(colDef.type)
      const actualType = normalizeType(actualCol.type)
      if (expectedType !== actualType) {
        diffs.push({
          type: 'column_type_mismatch',
          table: tableName,
          column: colName,
          expected: expectedType,
          actual: actualType,
        })
      }

      // Compare nullable
      // Primary key columns are implicitly NOT NULL
      const expectedNullable = !colDef.notNull && !colDef.primaryKey
      if (expectedNullable !== actualCol.nullable) {
        diffs.push({
          type: 'column_nullable_mismatch',
          table: tableName,
          column: colName,
          expected: expectedNullable ? 'nullable' : 'not null',
          actual: actualCol.nullable ? 'nullable' : 'not null',
        })
      }
    }

    // Check for extra columns in database (in schema.ts but removed from migrations)
    for (const [colName] of actualTable.columns) {
      if (!tableDef.columns[colName]) {
        diffs.push({
          type: 'extra_column',
          table: tableName,
          column: colName,
        })
      }
    }

    // Compare indexes
    for (const idxName of Object.keys(tableDef.indexes)) {
      if (!actualTable.indexes.has(idxName)) {
        diffs.push({
          type: 'missing_index',
          table: tableName,
          index: idxName,
        })
      }
    }

    // Compare foreign keys by semantic meaning (columns -> table), not by name
    // This allows migration SQL to use inline REFERENCES syntax with auto-generated names
    for (const [fkName, fkDef] of Object.entries(tableDef.foreignKeys)) {
      const columnsFrom = fkDef.columnsFrom.sort().join(',')
      const columnsTo = fkDef.columnsTo.sort().join(',')
      const matchingFk = actualTable.foreignKeys.find(actualFk => {
        const actualColumnsFrom = actualFk.fromColumns.sort().join(',')
        const actualColumnsTo = actualFk.toColumns.sort().join(',')
        return actualColumnsFrom === columnsFrom &&
               actualColumnsTo === columnsTo &&
               actualFk.toTable === fkDef.tableTo
      })

      if (!matchingFk) {
        diffs.push({
          type: 'missing_foreign_key',
          table: tableName,
          foreignKey: fkName,
          expected: `(${fkDef.columnsFrom.join(', ')}) references ${fkDef.tableTo}(${fkDef.columnsTo.join(', ')})`,
        })
      }
    }
  }

  // Check for extra tables in database
  for (const [tableName] of actual.tables) {
    const tableKey = `public.${tableName}`
    if (!expected.tables[tableKey]) {
      diffs.push({
        type: 'extra_table',
        table: tableName,
      })
    }
  }

  return diffs
}

/**
 * Format diff errors into a human-readable message
 */
function formatDiffError(diffs: SchemaDiff[]): string {
  const missing: string[] = []
  const extra: string[] = []
  const mismatch: string[] = []

  for (const diff of diffs) {
    switch (diff.type) {
      case 'missing_table':
        missing.push(`Table '${diff.table}' not found`)
        break
      case 'missing_column':
        missing.push(`Column '${diff.table}.${diff.column}' not found (expected type: ${diff.expected})`)
        break
      case 'missing_index':
        missing.push(`Index '${diff.index}' on '${diff.table}' not found`)
        break
      case 'missing_foreign_key':
        missing.push(`Foreign key '${diff.foreignKey}' on '${diff.table}' not found (${diff.expected})`)
        break
      case 'missing_enum':
        missing.push(`Enum '${diff.enum}' not found (expected values: ${diff.expected})`)
        break
      case 'extra_table':
        extra.push(`Table '${diff.table}' exists but not in schema.ts`)
        break
      case 'extra_column':
        extra.push(`Column '${diff.table}.${diff.column}' exists but not in schema.ts`)
        break
      case 'column_type_mismatch':
        mismatch.push(`Column '${diff.table}.${diff.column}' type mismatch: expected '${diff.expected}', got '${diff.actual}'`)
        break
      case 'column_nullable_mismatch':
        mismatch.push(`Column '${diff.table}.${diff.column}' nullable mismatch: expected '${diff.expected}', got '${diff.actual}'`)
        break
      case 'enum_values_mismatch':
        mismatch.push(`Enum '${diff.enum}' values mismatch: expected [${diff.expected}], got [${diff.actual}]`)
        break
    }
  }

  const lines = [
    '',
    '❌ Schema and migration SQL are out of sync!',
    '',
  ]

  if (missing.length > 0) {
    lines.push('Missing in database (need migration):')
    for (const msg of missing) {
      lines.push(`  - ${msg}`)
    }
    lines.push('')
  }

  if (extra.length > 0) {
    lines.push('Extra in database (may need cleanup or schema.ts update):')
    for (const msg of extra) {
      lines.push(`  - ${msg}`)
    }
    lines.push('')
  }

  if (mismatch.length > 0) {
    lines.push('Type/constraint mismatches:')
    for (const msg of mismatch) {
      lines.push(`  - ${msg}`)
    }
    lines.push('')
  }

  lines.push('To fix:')
  lines.push('  1. cd backend && pnpm codegen')
  lines.push('  2. Edit the generated SQL file if needed')
  lines.push('  3. pnpm db:try-migrate')
  lines.push('')

  return lines.join('\n')
}

/**
 * Validate that schema.ts and migration SQL are in sync.
 *
 * @param client - PGLite instance after running migrations
 * @param schema - Backend schema exports (from schema.ts)
 * @throws Error if schema and migrations are out of sync
 */
export async function validateSchemaMigrationConsistency(
  client: PGlite,
  schema: Record<string, unknown>
): Promise<void> {
  // Generate expected structure from schema.ts
  const expected = generateDrizzleJson(schema)

  // Get actual structure from database
  const actual = await introspectDatabase(client)

  // Compare and find differences
  const diffs = compareSchemas(expected, actual)

  if (diffs.length > 0) {
    throw new Error(formatDiffError(diffs))
  }
}
