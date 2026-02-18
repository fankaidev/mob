/**
 * Browser-compatible drizzle-kit implementation.
 * Provides generateDrizzleJson and generateMigration without node.js dependencies.
 */

import { generatePgSnapshot, prepareFromExports } from './pgSerializer'
import { generateSqlStatements } from './sqlGenerator'
import type { PgSchemaInternal } from './types'

export type { PgSchemaInternal as DrizzleSnapshotJSON }

/**
 * Generate a Drizzle JSON snapshot from schema exports.
 * This is the browser-compatible equivalent of drizzle-kit's generateDrizzleJson.
 */
export function generateDrizzleJson(
  imports: Record<string, unknown>,
  prevId?: string,
  schemaFilters?: string[],
  casing?: 'snake_case' | 'camelCase',
): PgSchemaInternal {
  const prepared = prepareFromExports(imports)

  // Generate a simple UUID for browser (crypto.randomUUID is available in modern browsers)
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0
          const v = c === 'x' ? r : (r & 0x3) | 0x8
          return v.toString(16)
        })

  const originUUID = '00000000-0000-4000-8000-000000000000'

  const snapshot = generatePgSnapshot(
    prepared.tables,
    prepared.enums,
    prepared.schemas,
    casing,
    schemaFilters,
  )

  return {
    ...snapshot,
    id,
    prevId: prevId ?? originUUID,
  } as PgSchemaInternal
}

/**
 * Generate migration SQL statements from comparing two snapshots.
 * For simplicity, this implementation only supports generating DDL from scratch
 * (comparing with an empty snapshot).
 */
export async function generateMigration(
  prev: PgSchemaInternal,
  cur: PgSchemaInternal,
): Promise<string[]> {
  // For now, we only support generating from empty to current
  // This is the most common use case for FAST_PROTOTYPE_MODE
  const isPrevEmpty =
    Object.keys(prev.tables).length === 0 &&
    Object.keys(prev.enums).length === 0 &&
    Object.keys(prev.schemas).length === 0

  if (!isPrevEmpty) {
    // For non-empty prev, we'd need full diff logic
    // For now, just generate all statements from current
    console.warn('generateMigration: prev snapshot is not empty, generating full DDL from current')
  }

  return generateSqlStatements(cur)
}

/**
 * Create an empty PostgreSQL snapshot (represents empty database).
 */
export function createEmptySnapshot(): PgSchemaInternal {
  return {
    version: '7',
    dialect: 'postgresql',
    id: '00000000-0000-4000-8000-000000000000',
    prevId: '00000000-0000-4000-8000-000000000000',
    tables: {},
    enums: {},
    schemas: {},
    sequences: {},
    roles: {},
    policies: {},
    views: {},
    _meta: {
      columns: {},
      schemas: {},
      tables: {},
    },
  } as PgSchemaInternal
}

// Re-export types
export type {
  Column,
  Table,
  Enum,
  Index,
  ForeignKey,
  PrimaryKey,
  UniqueConstraint,
  CheckConstraint,
} from './types'
