/**
 * Browser-compatible types extracted from drizzle-kit.
 * These types define the snapshot JSON structure used for SQL generation.
 */

export interface Column {
  name: string
  type: string
  typeSchema?: string
  primaryKey: boolean
  notNull: boolean
  default?: unknown
  isUnique?: boolean
  uniqueName?: string
  nullsNotDistinct?: boolean
  generated?: {
    type: 'stored'
    as: string
  }
  identity?: {
    name: string
    type: 'always' | 'byDefault'
    schema: string
    increment?: string
    minValue?: string
    maxValue?: string
    startWith?: string
    cache?: string
    cycle?: boolean
  }
}

export interface Index {
  name: string
  columns: IndexColumn[]
  isUnique: boolean
  with?: Record<string, unknown>
  method: string
  where?: string
  concurrently: boolean
}

export interface IndexColumn {
  expression: string
  isExpression: boolean
  asc: boolean
  nulls?: string
  opclass?: string
}

export interface ForeignKey {
  name: string
  tableFrom: string
  columnsFrom: string[]
  tableTo: string
  schemaTo?: string
  columnsTo: string[]
  onUpdate?: string
  onDelete?: string
}

export interface PrimaryKey {
  name: string
  columns: string[]
}

export interface UniqueConstraint {
  name: string
  columns: string[]
  nullsNotDistinct: boolean
}

export interface CheckConstraint {
  name: string
  value: string
}

export interface Policy {
  name: string
  as?: 'PERMISSIVE' | 'RESTRICTIVE'
  for?: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
  to?: string[]
  using?: string
  withCheck?: string
  on?: string
  schema?: string
}

export interface Table {
  name: string
  schema: string
  columns: Record<string, Column>
  indexes: Record<string, Index>
  foreignKeys: Record<string, ForeignKey>
  compositePrimaryKeys: Record<string, PrimaryKey>
  uniqueConstraints: Record<string, UniqueConstraint>
  policies: Record<string, Policy>
  checkConstraints: Record<string, CheckConstraint>
  isRLSEnabled: boolean
}

export interface Enum {
  name: string
  schema: string
  values: string[]
}

export interface Sequence {
  name: string
  schema: string
  increment?: string
  minValue?: string
  maxValue?: string
  startWith?: string
  cache?: string
  cycle?: boolean
}

export interface Role {
  name: string
  createDb?: boolean
  createRole?: boolean
  inherit?: boolean
}

export interface View {
  name: string
  schema: string
  columns: Record<string, Column>
  definition?: string
  materialized: boolean
  with?: Record<string, unknown>
  isExisting: boolean
  withNoData?: boolean
  using?: string
  tablespace?: string
}

export interface PgSchemaInternal {
  version: '7'
  dialect: 'postgresql'
  tables: Record<string, Table>
  enums: Record<string, Enum>
  schemas: Record<string, string>
  sequences: Record<string, Sequence>
  roles: Record<string, Role>
  policies: Record<string, Policy>
  views: Record<string, View>
  _meta: {
    schemas: Record<string, string>
    tables: Record<string, string>
    columns: Record<string, string>
  }
}

// Squashed types for comparison (simplified string representations)
export interface ColumnSquashed extends Omit<Column, 'identity'> {
  identity?: string
}

export interface TableSquashed {
  name: string
  schema: string
  columns: Record<string, ColumnSquashed>
  indexes: Record<string, string>
  foreignKeys: Record<string, string>
  compositePrimaryKeys: Record<string, string>
  uniqueConstraints: Record<string, string>
  policies: Record<string, string>
  checkConstraints: Record<string, string>
  isRLSEnabled: boolean
}

export interface PgSchemaSquashed {
  version: '7'
  dialect: 'postgresql'
  tables: Record<string, TableSquashed>
  enums: Record<string, Enum>
  schemas: Record<string, string>
  sequences: Record<string, { name: string; schema: string; values: string }>
  roles: Record<string, Role>
  policies: Record<string, { name: string; values: string }>
  views: Record<string, View>
}
