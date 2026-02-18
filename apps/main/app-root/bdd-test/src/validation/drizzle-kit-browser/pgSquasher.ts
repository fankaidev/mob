/**
 * Browser-compatible squash/unsquash utilities extracted from drizzle-kit.
 * These convert between structured objects and string representations for comparison.
 */

import type {
  CheckConstraint,
  ForeignKey,
  Index,
  PrimaryKey,
  Sequence,
  UniqueConstraint,
} from './types'

export const PgSquasher = {
  squashIdx: (idx: Index): string => {
    const columns = idx.columns
      .map((c) => `${c.expression}--${c.isExpression}--${c.asc}--${c.nulls}--${c.opclass}`)
      .join(',,')
    const withPart = idx.with ? Object.entries(idx.with).map(([k, v]) => `${k}=${v}`).join(',') : ''
    return `${idx.name};${columns};${idx.isUnique};${idx.method};${idx.where ?? ''};${idx.concurrently};${withPart}`
  },

  unsquashIdx: (input: string): Index => {
    const [name, columnsStr, isUnique, method, where, concurrently, withStr] = input.split(';')
    const columns = columnsStr.split(',,').map((c) => {
      const [expression, isExpression, asc, nulls, opclass] = c.split('--')
      return {
        expression,
        isExpression: isExpression === 'true',
        asc: asc === 'true',
        nulls: nulls !== 'undefined' ? nulls : undefined,
        opclass: opclass !== 'undefined' ? opclass : undefined,
      }
    })
    const withObj: Record<string, string> = {}
    if (withStr) {
      withStr.split(',').forEach((pair) => {
        const [k, v] = pair.split('=')
        if (k) withObj[k] = v
      })
    }
    return {
      name,
      columns,
      isUnique: isUnique === 'true',
      method: method || 'btree',
      where: where || undefined,
      concurrently: concurrently === 'true',
      with: Object.keys(withObj).length > 0 ? withObj : undefined,
    }
  },

  squashFK: (fk: ForeignKey): string => {
    return `${fk.name};${fk.tableFrom};${fk.columnsFrom.join(',')};${fk.tableTo};${fk.columnsTo.join(',')};${fk.onUpdate ?? ''};${fk.onDelete ?? ''};${fk.schemaTo ?? ''}`
  },

  unsquashFK: (input: string): ForeignKey => {
    const [name, tableFrom, columnsFromStr, tableTo, columnsToStr, onUpdate, onDelete, schemaTo] =
      input.split(';')
    return {
      name,
      tableFrom,
      columnsFrom: columnsFromStr.split(','),
      tableTo,
      columnsTo: columnsToStr.split(','),
      onUpdate: onUpdate || undefined,
      onDelete: onDelete || undefined,
      schemaTo: schemaTo || undefined,
    }
  },

  squashPK: (pk: PrimaryKey): string => {
    return `${pk.columns.join(',')};${pk.name}`
  },

  unsquashPK: (pk: string): PrimaryKey => {
    const [columnsStr, name] = pk.split(';')
    return { name, columns: columnsStr.split(',') }
  },

  squashUnique: (unq: UniqueConstraint): string => {
    return `${unq.name};${unq.columns.join(',')};${unq.nullsNotDistinct}`
  },

  unsquashUnique: (unq: string): UniqueConstraint => {
    const [name, columnsStr, nullsNotDistinct] = unq.split(';')
    return {
      name,
      columns: columnsStr.split(','),
      nullsNotDistinct: nullsNotDistinct === 'true',
    }
  },

  squashCheck: (check: CheckConstraint): string => {
    return `${check.name};${check.value}`
  },

  unsquashCheck: (input: string): CheckConstraint => {
    const [name, ...rest] = input.split(';')
    return { name, value: rest.join(';') }
  },

  squashSequence: (seq: Omit<Sequence, 'name' | 'schema'>): string => {
    return `${seq.minValue ?? ''};${seq.maxValue ?? ''};${seq.increment ?? ''};${seq.startWith ?? ''};${seq.cache ?? ''};${seq.cycle ?? ''}`
  },

  unsquashSequence: (seq: string): Omit<Sequence, 'name' | 'schema'> => {
    const [minValue, maxValue, increment, startWith, cache, cycle] = seq.split(';')
    return {
      minValue: minValue || undefined,
      maxValue: maxValue || undefined,
      increment: increment || undefined,
      startWith: startWith || undefined,
      cache: cache || undefined,
      cycle: cycle === 'true',
    }
  },

  squashIdentity: (
    seq: Omit<Sequence, 'schema'> & { type: 'always' | 'byDefault' },
  ): string => {
    return `${seq.name};${seq.type};${seq.minValue ?? ''};${seq.maxValue ?? ''};${seq.increment ?? ''};${seq.startWith ?? ''};${seq.cache ?? ''};${seq.cycle ?? ''}`
  },

  unsquashIdentity: (
    seq: string,
  ): Omit<Sequence, 'schema'> & { type: 'always' | 'byDefault' } => {
    const [name, type, minValue, maxValue, increment, startWith, cache, cycle] = seq.split(';')
    return {
      name,
      type: type as 'always' | 'byDefault',
      minValue: minValue || undefined,
      maxValue: maxValue || undefined,
      increment: increment || undefined,
      startWith: startWith || undefined,
      cache: cache || undefined,
      cycle: cycle === 'true',
    }
  },
}
