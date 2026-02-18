/**
 * Browser-compatible SQL generator extracted from drizzle-kit.
 * Generates PostgreSQL DDL statements from snapshot JSON.
 */

import type {
  CheckConstraint,
  Column,
  Enum,
  ForeignKey,
  Index,
  PgSchemaInternal,
  PrimaryKey,
  Table,
  UniqueConstraint,
} from './types'

// PostgreSQL native types that don't need schema prefix
const PG_NATIVE_TYPES = [
  'uuid',
  'smallint',
  'integer',
  'bigint',
  'boolean',
  'text',
  'varchar',
  'serial',
  'bigserial',
  'decimal',
  'numeric',
  'real',
  'json',
  'jsonb',
  'time',
  'time with time zone',
  'time without time zone',
  'timestamp',
  'timestamp with time zone',
  'timestamp without time zone',
  'date',
  'interval',
  'double precision',
  'char',
  'vector',
  'geometry',
  'halfvec',
  'sparsevec',
  'bit',
]

/**
 * Parse type and add schema prefix if needed
 */
function parseType(schemaPrefix: string, type: string): string {
  const arrayDefinitionRegex = /\[\d*(?:\[\d*\])*\]/g
  const arrayDefinition = (type.match(arrayDefinitionRegex) ?? []).join('')
  const withoutArrayDefinition = type.replace(arrayDefinitionRegex, '')

  const isNative = PG_NATIVE_TYPES.some((nativeType) => type.startsWith(nativeType))
  return isNative
    ? `${withoutArrayDefinition}${arrayDefinition}`
    : `${schemaPrefix}"${withoutArrayDefinition}"${arrayDefinition}`
}

/**
 * Generate CREATE TYPE statement for an enum
 */
function generateCreateEnum(enumDef: Enum): string {
  const schemaPrefix = enumDef.schema && enumDef.schema !== 'public' ? `"${enumDef.schema}".` : ''
  const values = enumDef.values.map((v) => `'${v}'`).join(', ')
  return `CREATE TYPE ${schemaPrefix}"${enumDef.name}" AS ENUM(${values});`
}

/**
 * Generate CREATE TABLE statement
 */
function generateCreateTable(table: Table): string[] {
  const statements: string[] = []
  const schemaPrefix = table.schema && table.schema !== '' ? `"${table.schema}".` : ''
  const tableName = `${schemaPrefix}"${table.name}"`

  let statement = `CREATE TABLE ${tableName} (\n`

  const columns = Object.values(table.columns)
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i]

    const primaryKeyStatement = column.primaryKey ? ' PRIMARY KEY' : ''
    const notNullStatement = column.notNull && !column.identity ? ' NOT NULL' : ''
    const defaultStatement = column.default !== undefined ? ` DEFAULT ${column.default}` : ''

    const uniqueConstraint =
      column.isUnique && column.uniqueName
        ? ` CONSTRAINT "${column.uniqueName}" UNIQUE${column.nullsNotDistinct ? ' NULLS NOT DISTINCT' : ''}`
        : ''

    const typeSchemaPrefix =
      column.typeSchema && column.typeSchema !== 'public' ? `"${column.typeSchema}".` : ''

    const type = parseType(typeSchemaPrefix, column.type)
    const generatedStatement = column.generated
      ? ` GENERATED ALWAYS AS (${column.generated.as}) STORED`
      : ''

    // Handle identity
    let identityStatement = ''
    if (column.identity) {
      const id = column.identity
      const identitySchema = id.schema && id.schema !== 'public' ? `"${id.schema}".` : ''
      identityStatement = ` GENERATED ${id.type === 'always' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY (sequence name ${identitySchema}"${id.name}"${id.increment ? ` INCREMENT BY ${id.increment}` : ''}${id.minValue ? ` MINVALUE ${id.minValue}` : ''}${id.maxValue ? ` MAXVALUE ${id.maxValue}` : ''}${id.startWith ? ` START WITH ${id.startWith}` : ''}${id.cache ? ` CACHE ${id.cache}` : ''}${id.cycle ? ' CYCLE' : ''})`
    }

    statement += `\t"${column.name}" ${type}${primaryKeyStatement}${defaultStatement}${generatedStatement}${notNullStatement}${uniqueConstraint}${identityStatement}`
    statement += i === columns.length - 1 ? '' : ',\n'
  }

  // Add composite primary keys
  const compositePKs = Object.values(table.compositePrimaryKeys)
  if (compositePKs.length > 0) {
    const pk = compositePKs[0]
    statement += ',\n'
    statement += `\tCONSTRAINT "${pk.name}" PRIMARY KEY("${pk.columns.join('","')}")`
  }

  // Add unique constraints
  const uniqueConstraints = Object.values(table.uniqueConstraints)
  for (const unq of uniqueConstraints) {
    // Skip if already added as column constraint
    if (columns.some((c) => c.uniqueName === unq.name)) continue
    statement += ',\n'
    statement += `\tCONSTRAINT "${unq.name}" UNIQUE${unq.nullsNotDistinct ? ' NULLS NOT DISTINCT' : ''}("${unq.columns.join('","')}")`
  }

  // Add check constraints
  const checkConstraints = Object.values(table.checkConstraints)
  for (const check of checkConstraints) {
    statement += ',\n'
    statement += `\tCONSTRAINT "${check.name}" CHECK (${check.value})`
  }

  statement += '\n);'
  statements.push(statement)

  // Add RLS if enabled
  if (table.isRLSEnabled) {
    statements.push(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;`)
  }

  return statements
}

/**
 * Generate CREATE INDEX statement
 */
function generateCreateIndex(tableName: string, schema: string, index: Index): string {
  const schemaPrefix = schema && schema !== '' ? `"${schema}".` : ''
  const tableNameWithSchema = `${schemaPrefix}"${tableName}"`

  const uniquePart = index.isUnique ? 'UNIQUE ' : ''
  const concurrentlyPart = index.concurrently ? 'CONCURRENTLY ' : ''
  const methodPart = index.method !== 'btree' ? ` USING ${index.method}` : ''

  const columnsPart = index.columns
    .map((col) => {
      if (col.isExpression) {
        return col.expression
      }
      let result = `"${col.expression}"`
      if (col.opclass) {
        result += ` ${col.opclass}`
      }
      if (!col.asc) {
        result += ' DESC'
      }
      if (col.nulls) {
        result += col.nulls === 'first' ? ' NULLS FIRST' : ' NULLS LAST'
      }
      return result
    })
    .join(', ')

  const wherePart = index.where ? ` WHERE ${index.where}` : ''

  let withPart = ''
  if (index.with && Object.keys(index.with).length > 0) {
    const withOptions = Object.entries(index.with)
      .map(([k, v]) => `${k} = ${v}`)
      .join(', ')
    withPart = ` WITH (${withOptions})`
  }

  return `CREATE ${uniquePart}INDEX ${concurrentlyPart}"${index.name}" ON ${tableNameWithSchema}${methodPart} (${columnsPart})${withPart}${wherePart};`
}

/**
 * Generate ALTER TABLE ADD FOREIGN KEY statement
 */
function generateCreateForeignKey(tableName: string, schema: string, fk: ForeignKey): string {
  const schemaPrefix = schema && schema !== '' ? `"${schema}".` : ''
  const tableNameWithSchema = `${schemaPrefix}"${tableName}"`

  const toSchemaPrefix = fk.schemaTo && fk.schemaTo !== '' ? `"${fk.schemaTo}".` : ''
  const tableToWithSchema = `${toSchemaPrefix}"${fk.tableTo}"`

  const columnsFrom = fk.columnsFrom.map((c) => `"${c}"`).join(', ')
  const columnsTo = fk.columnsTo.map((c) => `"${c}"`).join(', ')

  const onDeletePart = fk.onDelete ? ` ON DELETE ${fk.onDelete}` : ''
  const onUpdatePart = fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : ''

  return `ALTER TABLE ${tableNameWithSchema} ADD CONSTRAINT "${fk.name}" FOREIGN KEY (${columnsFrom}) REFERENCES ${tableToWithSchema}(${columnsTo})${onUpdatePart}${onDeletePart};`
}

/**
 * Generate all DDL statements from a schema snapshot.
 * Returns statements in the correct order for execution.
 */
export function generateSqlStatements(snapshot: PgSchemaInternal): string[] {
  const statements: string[] = []

  // 1. Create schemas first
  for (const schemaName of Object.keys(snapshot.schemas)) {
    if (schemaName !== 'public') {
      statements.push(`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`)
    }
  }

  // 2. Create enums
  for (const enumDef of Object.values(snapshot.enums)) {
    statements.push(generateCreateEnum(enumDef))
  }

  // 3. Create tables (without foreign keys first)
  for (const table of Object.values(snapshot.tables)) {
    statements.push(...generateCreateTable(table))
  }

  // 4. Create indexes
  for (const table of Object.values(snapshot.tables)) {
    for (const index of Object.values(table.indexes)) {
      statements.push(generateCreateIndex(table.name, table.schema, index))
    }
  }

  // 5. Create foreign keys (after all tables exist)
  for (const table of Object.values(snapshot.tables)) {
    for (const fk of Object.values(table.foreignKeys)) {
      statements.push(generateCreateForeignKey(table.name, table.schema, fk))
    }
  }

  return statements
}
