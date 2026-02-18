/**
 * Browser-compatible PostgreSQL schema serializer extracted from drizzle-kit.
 * Converts Drizzle schema objects to JSON snapshot format.
 */

import { getTableName, is, SQL } from 'drizzle-orm'
import {
  type AnyPgTable,
  getTableConfig,
  type IndexedColumn,
  isPgEnum,
  PgArray,
  type PgColumn,
  PgDialect,
  type PgEnum,
  PgEnumColumn,
  type PgSchema,
  PgTable,
  uniqueKeyName,
} from 'drizzle-orm/pg-core'

import type {
  CheckConstraint,
  Column,
  Enum,
  ForeignKey,
  Index,
  IndexColumn,
  PgSchemaInternal,
  PrimaryKey,
  Table,
  UniqueConstraint,
} from './types'

// Prepare exports from schema module
export function prepareFromExports(exports: Record<string, unknown>) {
  const tables: AnyPgTable[] = []
  const enums: PgEnum<[string, ...string[]]>[] = []
  const schemas: PgSchema[] = []

  for (const value of Object.values(exports)) {
    if (isPgEnum(value)) {
      enums.push(value)
    } else if (is(value, PgTable)) {
      tables.push(value)
    } else if (
      typeof value === 'object' &&
      value !== null &&
      'schemaName' in value &&
      typeof (value as { schemaName: unknown }).schemaName === 'string'
    ) {
      schemas.push(value as PgSchema)
    }
  }

  return { tables, enums, schemas }
}

// Convert SQL to string
function sqlToStr(sql: SQL, casing?: 'snake_case' | 'camelCase'): string {
  const dialect = new PgDialect({ casing })
  return dialect.sqlToQuery(sql).sql
}

// Get column casing
function getColumnCasing(column: PgColumn | IndexedColumn, _casing?: 'snake_case' | 'camelCase'): string {
  // For simplicity, we'll just return the name as-is since most schemas use explicit names
  return column.name ?? ''
}

// Escape single quotes in strings
function escapeSingleQuotes(str: string): string {
  return str.replace(/'/g, "''")
}

// Check if type is a PG array type
function isPgArrayType(sqlType: string): boolean {
  return sqlType.includes('[]')
}

// Build array string for default values
function buildArrayString(array: unknown[], sqlType: string): string {
  const baseType = sqlType.split('[')[0]
  const values = array
    .map((value) => {
      if (typeof value === 'number' || typeof value === 'bigint') {
        return value.toString()
      } else if (typeof value === 'boolean') {
        return value ? 'true' : 'false'
      } else if (Array.isArray(value)) {
        return buildArrayString(value, baseType)
      } else if (value instanceof Date) {
        if (baseType === 'date') {
          return `"${value.toISOString().split('T')[0]}"`
        } else if (baseType === 'timestamp') {
          return `"${value.toISOString().replace('T', ' ').slice(0, 23)}"`
        } else {
          return `"${value.toISOString()}"`
        }
      } else if (typeof value === 'object' && value !== null) {
        return `"${JSON.stringify(value).replaceAll('"', '\\"')}"`
      }
      return `"${value}"`
    })
    .join(',')
  return `{${values}}`
}

// Helper to get identity range based on column type
function maxRangeForIdentityBasedOn(columnType: string): string {
  return columnType === 'integer'
    ? '2147483647'
    : columnType === 'bigint'
      ? '9223372036854775807'
      : '32767'
}

function minRangeForIdentityBasedOn(columnType: string): string {
  return columnType === 'integer'
    ? '-2147483648'
    : columnType === 'bigint'
      ? '-9223372036854775808'
      : '-32768'
}

function stringFromIdentityProperty(field: string | number | undefined): string | undefined {
  return typeof field === 'string'
    ? field
    : typeof field === 'undefined'
      ? undefined
      : String(field)
}

/**
 * Generate a PostgreSQL schema snapshot from Drizzle schema objects.
 */
export function generatePgSnapshot(
  tables: AnyPgTable[],
  enums: PgEnum<[string, ...string[]]>[],
  schemas: PgSchema[],
  casing?: 'snake_case' | 'camelCase',
  schemaFilter?: string[],
): PgSchemaInternal {
  const dialect = new PgDialect({ casing })
  const result: Record<string, Table> = {}

  for (const table of tables) {
    const {
      name: tableName,
      columns,
      indexes,
      foreignKeys,
      checks,
      schema,
      primaryKeys,
      uniqueConstraints,
      // policies, // Not handling policies for simplicity
      enableRLS,
    } = getTableConfig(table)

    if (schemaFilter && !schemaFilter.includes(schema ?? 'public')) {
      continue
    }

    const columnsObject: Record<string, Column> = {}
    const indexesObject: Record<string, Index> = {}
    const checksObject: Record<string, CheckConstraint> = {}
    const foreignKeysObject: Record<string, ForeignKey> = {}
    const primaryKeysObject: Record<string, PrimaryKey> = {}
    const uniqueConstraintObject: Record<string, UniqueConstraint> = {}

    // Process columns
    for (const column of columns) {
      const name = getColumnCasing(column, casing)
      const notNull = column.notNull
      const primaryKey = column.primary
      const sqlTypeLowered = column.getSQLType().toLowerCase()

      // Get enum schema if applicable
      const getEnumSchema = (col: PgColumn): string | undefined => {
        let c = col
        while (is(c, PgArray)) {
          c = (c as unknown as { baseColumn: PgColumn }).baseColumn
        }
        return is(c, PgEnumColumn)
          ? ((c as unknown as { enum: { schema?: string } }).enum.schema || 'public')
          : undefined
      }
      const typeSchema = getEnumSchema(column)

      const generated = column.generated
      const identity = column.generatedIdentity

      const increment = stringFromIdentityProperty(identity?.sequenceOptions?.increment) ?? '1'
      const minValue =
        stringFromIdentityProperty(identity?.sequenceOptions?.minValue) ??
        (parseFloat(increment) < 0 ? minRangeForIdentityBasedOn(column.columnType) : '1')
      const maxValue =
        stringFromIdentityProperty(identity?.sequenceOptions?.maxValue) ??
        (parseFloat(increment) < 0 ? '-1' : maxRangeForIdentityBasedOn(column.getSQLType()))
      const startWith =
        stringFromIdentityProperty(identity?.sequenceOptions?.startWith) ??
        (parseFloat(increment) < 0 ? maxValue : minValue)
      const cache = stringFromIdentityProperty(identity?.sequenceOptions?.cache) ?? '1'

      const columnToSet: Column = {
        name,
        type: column.getSQLType(),
        typeSchema,
        primaryKey,
        notNull,
        generated: generated
          ? {
              as: is(generated.as, SQL)
                ? dialect.sqlToQuery(generated.as as SQL).sql
                : typeof generated.as === 'function'
                  ? dialect.sqlToQuery((generated.as as () => SQL)()).sql
                  : String(generated.as),
              type: 'stored',
            }
          : undefined,
        identity: identity
          ? {
              type: identity.type,
              name: identity.sequenceName ?? `${tableName}_${name}_seq`,
              schema: schema ?? 'public',
              increment,
              startWith,
              minValue,
              maxValue,
              cache,
              cycle: identity?.sequenceOptions?.cycle ?? false,
            }
          : undefined,
      }

      // Handle unique constraint on column
      if (column.isUnique) {
        uniqueConstraintObject[column.uniqueName!] = {
          name: column.uniqueName!,
          nullsNotDistinct: column.uniqueType === 'not distinct',
          columns: [columnToSet.name],
        }
      }

      // Handle default value
      if (column.default !== undefined) {
        if (is(column.default, SQL)) {
          columnToSet.default = sqlToStr(column.default, casing)
        } else {
          if (typeof column.default === 'string') {
            columnToSet.default = `'${escapeSingleQuotes(column.default)}'`
          } else if (sqlTypeLowered === 'jsonb' || sqlTypeLowered === 'json') {
            columnToSet.default = `'${JSON.stringify(column.default)}'::${sqlTypeLowered}`
          } else if (column.default instanceof Date) {
            if (sqlTypeLowered === 'date') {
              columnToSet.default = `'${column.default.toISOString().split('T')[0]}'`
            } else if (sqlTypeLowered === 'timestamp') {
              columnToSet.default = `'${column.default.toISOString().replace('T', ' ').slice(0, 23)}'`
            } else {
              columnToSet.default = `'${column.default.toISOString()}'`
            }
          } else if (isPgArrayType(sqlTypeLowered) && Array.isArray(column.default)) {
            columnToSet.default = `'${buildArrayString(column.default, sqlTypeLowered)}'`
          } else {
            columnToSet.default = column.default
          }
        }
      }

      columnsObject[name] = columnToSet
    }

    // Process primary keys
    for (const pk of primaryKeys) {
      const columnNames = pk.columns.map((c) => getColumnCasing(c, casing))
      const name = pk.getName()
      primaryKeysObject[name] = { name, columns: columnNames }
    }

    // Process unique constraints
    for (const unq of uniqueConstraints ?? []) {
      const columnNames = unq.columns.map((c) => getColumnCasing(c, casing))
      const name = unq.name ?? uniqueKeyName(table, columnNames)
      uniqueConstraintObject[name] = {
        name: unq.name!,
        nullsNotDistinct: unq.nullsNotDistinct,
        columns: columnNames,
      }
    }

    // Process foreign keys
    for (const fk of foreignKeys) {
      const reference = fk.reference()
      const tableTo = getTableName(reference.foreignTable)
      const schemaTo = getTableConfig(reference.foreignTable).schema
      const columnsFrom = reference.columns.map((c) => getColumnCasing(c, casing))
      const columnsTo = reference.foreignColumns.map((c) => getColumnCasing(c, casing))
      const name = fk.getName()

      foreignKeysObject[name] = {
        name,
        tableFrom: tableName,
        tableTo,
        schemaTo,
        columnsFrom,
        columnsTo,
        onDelete: fk.onDelete,
        onUpdate: fk.onUpdate,
      }
    }

    // Process indexes
    for (const value of indexes) {
      const idxColumns = value.config.columns
      const indexColumnNames: string[] = []

      for (const col of idxColumns) {
        if (is(col, SQL)) {
          // Expression index - name must be provided
        } else {
          indexColumnNames.push(getColumnCasing(col as IndexedColumn, casing))
        }
      }

      const name = value.config.name ?? `${tableName}_${indexColumnNames.join('_')}_index`

      const indexColumns: IndexColumn[] = idxColumns.map((col) => {
        if (is(col, SQL)) {
          return {
            expression: dialect.sqlToQuery(col, 'indexes').sql,
            asc: true,
            isExpression: true,
            nulls: 'last',
          }
        } else {
          const indexed = col as IndexedColumn
          return {
            expression: getColumnCasing(indexed, casing),
            isExpression: false,
            asc: indexed.indexConfig?.order === 'asc',
            nulls: indexed.indexConfig?.nulls ?? (indexed.indexConfig?.order === 'desc' ? 'first' : 'last'),
            opclass: indexed.indexConfig?.opClass,
          }
        }
      })

      indexesObject[name] = {
        name,
        columns: indexColumns,
        isUnique: value.config.unique ?? false,
        where: value.config.where ? dialect.sqlToQuery(value.config.where).sql : undefined,
        concurrently: value.config.concurrently ?? false,
        method: value.config.method ?? 'btree',
        with: value.config.with ?? {},
      }
    }

    // Process check constraints
    for (const check of checks) {
      checksObject[check.name] = {
        name: check.name,
        value: dialect.sqlToQuery(check.value).sql,
      }
    }

    const tableKey = `${schema ?? 'public'}.${tableName}`
    result[tableKey] = {
      name: tableName,
      schema: schema ?? '',
      columns: columnsObject,
      indexes: indexesObject,
      foreignKeys: foreignKeysObject,
      compositePrimaryKeys: primaryKeysObject,
      uniqueConstraints: uniqueConstraintObject,
      policies: {}, // Simplified - not handling policies for now
      checkConstraints: checksObject,
      isRLSEnabled: enableRLS,
    }
  }

  // Process enums
  const enumsToReturn: Record<string, Enum> = {}
  for (const e of enums) {
    const enumSchema = e.schema || 'public'
    const key = `${enumSchema}.${e.enumName}`
    enumsToReturn[key] = {
      name: e.enumName,
      schema: enumSchema,
      values: [...e.enumValues],
    }
  }

  // Process schemas
  const schemasObject = Object.fromEntries(
    schemas
      .filter((s) => {
        const name = s.schemaName
        if (schemaFilter) {
          return schemaFilter.includes(name) && name !== 'public'
        }
        return name !== 'public'
      })
      .map((s) => [s.schemaName, s.schemaName]),
  )

  return {
    version: '7',
    dialect: 'postgresql',
    tables: result,
    enums: enumsToReturn,
    schemas: schemasObject,
    sequences: {},
    roles: {},
    policies: {},
    views: {},
    _meta: {
      schemas: {},
      tables: {},
      columns: {},
    },
  }
}
