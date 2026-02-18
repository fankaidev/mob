import { generateDrizzleJson } from 'drizzle-kit/api';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants for directories
const DRIZZLE_DIR = join(__dirname, '../drizzle');
const META_DIR = join(DRIZZLE_DIR, 'meta');
const JOURNAL_PATH = join(META_DIR, '_journal.json');
const MIGRATIONS_TS_PATH = join(DRIZZLE_DIR, 'migrations.ts');

// --- Types ---

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export interface Snapshot {
  id: string;
  prevId: string;
  version: string;
  dialect: string;
  tables: Record<string, TableDef>;
  enums: Record<string, EnumDef>;
  schemas: Record<string, unknown>;
  sequences: Record<string, unknown>;
  roles: Record<string, unknown>;
  policies: Record<string, unknown>;
  views: Record<string, unknown>;
  _meta: {
    columns: Record<string, string>;
    schemas: Record<string, string>;
    tables: Record<string, string>;
  };
}

export interface ColumnDef {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  default?: string;
  typeSchema?: string;
}

export interface ForeignKeyDef {
  name: string;
  tableFrom: string;
  tableTo: string;
  columnsFrom: string[];
  columnsTo: string[];
  onDelete?: string;
  onUpdate?: string;
}

export interface UniqueConstraintDef {
  name: string;
  columns: string[];
  nullsNotDistinct: boolean;
}

export interface IndexDef {
  name: string;
  columns: {
    expression: string;
    isExpression: boolean;
    asc: boolean;
    nulls?: string;
    opclass?: string;
  }[];
  isUnique: boolean;
  concurrently?: boolean;
  method?: string;
  where?: string;
  with?: Record<string, string>;
}

export interface TableDef {
  name: string;
  schema: string;
  columns: Record<string, ColumnDef>;
  indexes: Record<string, IndexDef>;
  foreignKeys: Record<string, ForeignKeyDef>;
  compositePrimaryKeys: Record<string, unknown>;
  uniqueConstraints: Record<string, UniqueConstraintDef>;
  policies: Record<string, unknown>;
  checkConstraints: Record<string, unknown>;
  isRLSEnabled: boolean;
}

export interface EnumDef {
  name: string;
  schema: string;
  values: string[];
}

export interface DiffResult {
  comments: string[];
  newTables: string[];
}

// --- Handlebars Helpers ---

// Register Handlebars helper
Handlebars.registerHelper('toISOString', (timestamp: number) => {
  return new Date(timestamp).toISOString();
});

Handlebars.registerHelper('quote', (value: string) => `'${value}'`);

Handlebars.registerHelper('join', (array: string[], separator: string) => {
  return array.join(separator);
});

// --- SQL Template ---

export const template = `-- Migration: {{tag}}
-- Generated at: {{toISOString timestamp}}
--
{{#if isManualMigration}}
-- Manual migration (no schema changes)
-- Use this for: seed data, data migrations, or custom SQL
-- ============================================
{{else}}
-- Schema changes detected (implement manually):
-- ============================================
{{/if}}
{{#each diff.newEnums}}
-- [ADD ENUM] {{name}}: values = [{{#each values}}'{{this}}'{{#unless @last}}, {{/unless}}{{/each}}]
{{/each}}
{{#each diff.droppedEnums}}
-- [DROP ENUM] {{name}}
{{/each}}
{{#each diff.modifiedEnums}}
{{#if addedValues}}
-- [ALTER ENUM] {{name}}: add values [{{#each addedValues}}'{{this}}'{{#unless @last}}, {{/unless}}{{/each}}]
{{/if}}
{{#if removedValues}}
-- [ALTER ENUM] {{name}}: remove values [{{#each removedValues}}'{{this}}'{{#unless @last}}, {{/unless}}{{/each}}] (WARNING: PostgreSQL cannot remove enum values directly)
{{/if}}
{{/each}}
{{#each diff.newTables}}
-- [CREATE TABLE] {{name}} ({{#each columns}}{{this}}{{#unless @last}}, {{/unless}}{{/each}})
{{#each foreignKeys}}
-- [ADD FK] {{../name}}: {{name}} ({{#each columnsFrom}}{{this}}{{#unless @last}},{{/unless}}{{/each}}) -> {{tableTo}}({{#each columnsTo}}{{this}}{{#unless @last}},{{/unless}}{{/each}}) ON DELETE {{#if onDelete}}{{onDelete}}{{else}}NO ACTION{{/if}}
{{/each}}
{{#each uniqueConstraints}}
-- [ADD UNIQUE] {{../name}}: {{name}} on ({{#each columns}}{{this}}{{#unless @last}}, {{/unless}}{{/each}})
{{/each}}
{{#each indexes}}
-- [CREATE INDEX] {{name}} on {{../name}}({{#each columns}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}){{#if isUnique}} UNIQUE{{/if}}
{{/each}}
{{/each}}
{{#each diff.droppedTables}}
-- [DROP TABLE] {{name}}
{{/each}}
{{#each diff.modifiedTables}}
{{#each newColumns}}
-- [ADD COLUMN] {{../name}}.{{name}}: {{spec}}
{{/each}}
{{#each droppedColumns}}
-- [DROP COLUMN] {{../name}}.{{name}}
{{/each}}
{{#each modifiedColumns}}
-- [ALTER COLUMN] {{../tableName}}.{{name}}: {{#each changes}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
{{/each}}
{{#each newForeignKeys}}
-- [ADD FK] {{../name}}: {{name}} ({{#each columnsFrom}}{{this}}{{#unless @last}},{{/unless}}{{/each}}) -> {{tableTo}}({{#each columnsTo}}{{this}}{{#unless @last}},{{/unless}}{{/each}}) ON DELETE {{#if onDelete}}{{onDelete}}{{else}}NO ACTION{{/if}}
{{/each}}
{{#each droppedForeignKeys}}
-- [DROP FK] {{../name}}: {{name}}
{{/each}}
{{#each newUniqueConstraints}}
-- [ADD UNIQUE] {{../name}}: {{name}} on ({{#each columns}}{{this}}{{#unless @last}}, {{/unless}}{{/each}})
{{/each}}
{{#each droppedUniqueConstraints}}
-- [DROP UNIQUE] {{../name}}: {{name}}
{{/each}}
{{#each newIndexes}}
-- [CREATE INDEX] {{name}} on {{../name}}({{#each columns}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}){{#if isUnique}} UNIQUE{{/if}}
{{/each}}
{{#each droppedIndexes}}
-- [DROP INDEX] {{name}}
{{/each}}
{{/each}}
--
-- ============================================
-- Write your migration SQL below:
-- ============================================

-- TODO: Implement the migration based on the changes above

--> statement-breakpoint
{{#if auditTables}}

-- Audit triggers for new tables:
{{#each auditTables}}
{{#if this.isInsertOnly}}
CREATE TRIGGER {{this.name}}_audit_before
  BEFORE INSERT ON {{this.name}}
  FOR EACH ROW EXECUTE FUNCTION audit_before_insert_only_trigger();

CREATE TRIGGER {{this.name}}_audit_after
  AFTER INSERT OR DELETE ON {{this.name}}
  FOR EACH ROW EXECUTE FUNCTION audit_after_trigger();
{{else}}
CREATE TRIGGER {{this.name}}_audit_before
  BEFORE INSERT OR UPDATE ON {{this.name}}
  FOR EACH ROW EXECUTE FUNCTION audit_before_trigger();

CREATE TRIGGER {{this.name}}_audit_after
  AFTER INSERT OR UPDATE OR DELETE ON {{this.name}}
  FOR EACH ROW EXECUTE FUNCTION audit_after_trigger();
{{/if}}
{{#unless @last}}

{{/unless}}
{{/each}}

--> statement-breakpoint
{{/if}}
`;

// --- Logic ---

/**
 * Update migrations.ts file with all migration SQL imports.
 * This file is used by both browser PGLite and test infrastructure.
 */
function updateMigrationsTs(journal: Journal): void {
  const entries = journal.entries;

  // Generate import statements
  const imports = entries
    .map((entry, i) => `import migration${i.toString().padStart(4, '0')} from './${entry.tag}.sql?raw'`)
    .join('\n');

  // Generate migrations array
  const arrayItems = entries
    .map((_, i) => `  migration${i.toString().padStart(4, '0')},`)
    .join('\n');

  const content = `/**
 * Static list of migration SQL files with their contents.
 * Used by both browser PGLite and test infrastructure.
 *
 * AUTO-GENERATED by pnpm codegen. Do not edit manually.
 */
${imports}

// Migration SQL contents (in order)
export const migrations = [
${arrayItems}
] as const
`;

  writeFileSync(MIGRATIONS_TS_PATH, content);
}

function loadJournal(): Journal {
  if (!existsSync(JOURNAL_PATH)) {
    return {
      version: '7',
      dialect: 'postgresql',
      entries: [],
    };
  }
  return JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8'));
}

function loadLatestSnapshot(journal: Journal): Snapshot | null {
  if (journal.entries.length === 0) {
    return null;
  }

  const latestEntry = journal.entries[journal.entries.length - 1];
  const snapshotPath = join(META_DIR, `${latestEntry.idx.toString().padStart(4, '0')}_snapshot.json`);

  if (!existsSync(snapshotPath)) {
    return null;
  }

  return JSON.parse(readFileSync(snapshotPath, 'utf-8'));
}

export interface DiffData {
  newEnums: EnumDef[];
  droppedEnums: EnumDef[];
  modifiedEnums: { name: string; addedValues: string[]; removedValues: string[] }[];
  newTables: {
    name: string;
    columns: string[];
    foreignKeys: (ForeignKeyDef & { tableName: string })[];
    uniqueConstraints: (UniqueConstraintDef & { tableName: string })[];
    indexes: { name: string; tableName: string; columns: string[]; isUnique: boolean }[];
    isInsertOnly: boolean; // true if table has no updated_at column (insert-only, no updates allowed)
  }[];
  droppedTables: TableDef[];
  modifiedTables: {
    name: string;
    newColumns: { name: string; spec: string }[];
    droppedColumns: ColumnDef[];
    modifiedColumns: { tableName: string; name: string; changes: string[] }[];
    newForeignKeys: ForeignKeyDef[];
    droppedForeignKeys: ForeignKeyDef[];
    newUniqueConstraints: UniqueConstraintDef[];
    droppedUniqueConstraints: UniqueConstraintDef[];
    newIndexes: { name: string; columns: string[]; isUnique: boolean }[];
    droppedIndexes: IndexDef[];
  }[];
}

function prepareDiffData(prev: Snapshot | null, cur: Snapshot): DiffData {
  const diff: DiffData = {
    newEnums: [],
    droppedEnums: [],
    modifiedEnums: [],
    newTables: [],
    droppedTables: [],
    modifiedTables: [],
  };

  const prevTables = prev?.tables ?? {};
  const curTables = cur.tables ?? {};
  const prevEnums = prev?.enums ?? {};
  const curEnums = cur.enums ?? {};

  // Enums
  for (const [key, enumDef] of Object.entries(curEnums)) {
    if (!prevEnums[key]) {
      diff.newEnums.push(enumDef);
    }
  }
  for (const [key, enumDef] of Object.entries(prevEnums)) {
    if (!curEnums[key]) {
      diff.droppedEnums.push(enumDef);
    }
  }
  for (const [key, curEnum] of Object.entries(curEnums)) {
    const prevEnum = prevEnums[key];
    if (prevEnum) {
      const addedValues = curEnum.values.filter((v) => !prevEnum.values.includes(v));
      const removedValues = prevEnum.values.filter((v) => !curEnum.values.includes(v));
      if (addedValues.length > 0 || removedValues.length > 0) {
        diff.modifiedEnums.push({ name: curEnum.name, addedValues, removedValues });
      }
    }
  }

  // New Tables
  for (const [key, tableDef] of Object.entries(curTables)) {
    if (!prevTables[key]) {
      const columns = Object.values(tableDef.columns).map((col) => {
        let colDef = `${col.name} ${col.type}`;
        if (col.primaryKey) colDef += ' PRIMARY KEY';
        if (col.notNull) colDef += ' NOT NULL';
        if (col.default !== undefined) colDef += ` DEFAULT ${col.default}`;
        return colDef;
      });

      // Check if table has updated_at column (if not, it's insert-only)
      const hasUpdatedAt = Object.values(tableDef.columns).some((col) => col.name === 'updated_at');

      diff.newTables.push({
        name: tableDef.name,
        columns,
        foreignKeys: Object.values(tableDef.foreignKeys).map((fk) => ({ ...fk, tableName: tableDef.name })),
        uniqueConstraints: Object.values(tableDef.uniqueConstraints).map((uc) => ({ ...uc, tableName: tableDef.name })),
        indexes: Object.values(tableDef.indexes).map((idx) => ({
          name: idx.name,
          tableName: tableDef.name,
          columns: idx.columns.map((c) => c.expression),
          isUnique: idx.isUnique,
        })),
        isInsertOnly: !hasUpdatedAt,
      });
    }
  }

  // Dropped Tables
  for (const [key, tableDef] of Object.entries(prevTables)) {
    if (!curTables[key]) {
      diff.droppedTables.push(tableDef);
    }
  }

  // Modified Tables
  for (const [key, curTable] of Object.entries(curTables)) {
    const prevTable = prevTables[key];
    if (!prevTable) continue;

    const modifiedTable: DiffData['modifiedTables'][0] = {
      name: curTable.name,
      newColumns: [],
      droppedColumns: [],
      modifiedColumns: [],
      newForeignKeys: [],
      droppedForeignKeys: [],
      newUniqueConstraints: [],
      droppedUniqueConstraints: [],
      newIndexes: [],
      droppedIndexes: [],
    };

    // Columns
    for (const [colKey, colDef] of Object.entries(curTable.columns)) {
      if (!prevTable.columns[colKey]) {
        let colSpec = `${colDef.type}`;
        if (colDef.notNull) colSpec += ' NOT NULL';
        if (colDef.default !== undefined) colSpec += ` DEFAULT ${colDef.default}`;
        modifiedTable.newColumns.push({ name: colDef.name, spec: colSpec });
      } else {
        const prevCol = prevTable.columns[colKey];
        const changes: string[] = [];
        if (prevCol.type !== colDef.type) changes.push(`type: ${prevCol.type} -> ${colDef.type}`);
        if (prevCol.notNull !== colDef.notNull) changes.push(`notNull: ${prevCol.notNull} -> ${colDef.notNull}`);
        if (prevCol.default !== colDef.default)
          changes.push(`default: ${prevCol.default ?? 'NULL'} -> ${colDef.default ?? 'NULL'}`);
        if (changes.length > 0) {
          modifiedTable.modifiedColumns.push({ tableName: curTable.name, name: colDef.name, changes });
        }
      }
    }
    for (const [colKey, colDef] of Object.entries(prevTable.columns)) {
      if (!curTable.columns[colKey]) {
        modifiedTable.droppedColumns.push(colDef);
      }
    }

    // FKs
    for (const [fkKey, fkDef] of Object.entries(curTable.foreignKeys)) {
      if (!prevTable.foreignKeys[fkKey]) modifiedTable.newForeignKeys.push(fkDef);
    }
    for (const [fkKey, fkDef] of Object.entries(prevTable.foreignKeys)) {
      if (!curTable.foreignKeys[fkKey]) modifiedTable.droppedForeignKeys.push(fkDef);
    }

    // Unique
    for (const [ucKey, ucDef] of Object.entries(curTable.uniqueConstraints)) {
      if (!prevTable.uniqueConstraints[ucKey]) modifiedTable.newUniqueConstraints.push(ucDef);
    }
    for (const [ucKey, ucDef] of Object.entries(prevTable.uniqueConstraints)) {
      if (!curTable.uniqueConstraints[ucKey]) modifiedTable.droppedUniqueConstraints.push(ucDef);
    }

    // Indexes
    for (const [idxKey, idxDef] of Object.entries(curTable.indexes)) {
      if (!prevTable.indexes[idxKey]) {
        modifiedTable.newIndexes.push({
          name: idxDef.name,
          columns: idxDef.columns.map((c) => c.expression),
          isUnique: idxDef.isUnique,
        });
      }
    }
    for (const [idxKey, idxDef] of Object.entries(prevTable.indexes)) {
      if (!curTable.indexes[idxKey]) modifiedTable.droppedIndexes.push(idxDef);
    }

    const hasChanges =
      modifiedTable.newColumns.length > 0 ||
      modifiedTable.droppedColumns.length > 0 ||
      modifiedTable.modifiedColumns.length > 0 ||
      modifiedTable.newForeignKeys.length > 0 ||
      modifiedTable.droppedForeignKeys.length > 0 ||
      modifiedTable.newUniqueConstraints.length > 0 ||
      modifiedTable.droppedUniqueConstraints.length > 0 ||
      modifiedTable.newIndexes.length > 0 ||
      modifiedTable.droppedIndexes.length > 0;

    if (hasChanges) {
      diff.modifiedTables.push(modifiedTable);
    }
  }

  return diff;
}

export type AuditCapability = 'full' | 'insert-only' | 'none';

export interface GenerateOptions {
  newMigration?: boolean;
  auditCapabilities?: Map<string, AuditCapability>;
}

/**
 * Main generation function
 * @param schema The drizzle schema (import * as schema from './schema')
 * @param options Generation options
 */
export async function generateMigration(schema: Record<string, unknown>, options: GenerateOptions = {}) {
  console.log('🔄 Generating migration...\n');

  // Ensure directories exist
  if (!existsSync(DRIZZLE_DIR)) mkdirSync(DRIZZLE_DIR, { recursive: true });
  if (!existsSync(META_DIR)) mkdirSync(META_DIR, { recursive: true });

  // Load journal
  const journal = loadJournal();

  // Load previous snapshot
  const prevSnapshot = loadLatestSnapshot(journal);
  const prevId = prevSnapshot?.id ?? '00000000-0000-4000-8000-000000000000';

  // Generate current snapshot from schema
  const curSnapshot = generateDrizzleJson(schema, prevId) as Snapshot;

  // Prepare diff data for template
  const diff = prepareDiffData(prevSnapshot, curSnapshot);

  const hasChanges =
    diff.newEnums.length > 0 ||
    diff.droppedEnums.length > 0 ||
    diff.modifiedEnums.length > 0 ||
    diff.newTables.length > 0 ||
    diff.droppedTables.length > 0 ||
    diff.modifiedTables.length > 0;

  if (!hasChanges && !options.newMigration) {
    console.log('\n✅ No schema changes detected.');
    console.log('\n💡 To create a migration for seed data or manual SQL (without schema changes), run:');
    console.log('   pnpm codegen --new-migration\n');
    return;
  }

  // Determine next index and metadata
  const nextIdx = journal.entries.length;
  const timestamp = Date.now();
  const tag = `${nextIdx.toString().padStart(4, '0')}_migration`;

  // Track new tables for audit triggers (only tables with proper audit fields)
  const auditCapabilities = options.auditCapabilities ?? new Map<string, AuditCapability>();
  const auditTables = diff.newTables
    .filter((t) => {
      const capability = auditCapabilities.get(t.name);
      return capability === 'full' || capability === 'insert-only';
    })
    .map((t) => {
      const capability = auditCapabilities.get(t.name);
      return { name: t.name, isInsertOnly: capability === 'insert-only' };
    });

  const tablesWithoutAudit = diff.newTables
    .filter((t) => auditCapabilities.get(t.name) === 'none')
    .map((t) => t.name);

  if (auditTables.length > 0 || tablesWithoutAudit.length > 0) {
    const regularTables = auditTables.filter((t) => !t.isInsertOnly).map((t) => t.name);
    const insertOnlyTables = auditTables.filter((t) => t.isInsertOnly).map((t) => t.name);
    if (regularTables.length > 0) {
      console.log(`\n📝 + audit triggers: ${regularTables.join(', ')}`);
    }
    if (insertOnlyTables.length > 0) {
      console.log(`📝 + audit triggers (INSERT only): ${insertOnlyTables.join(', ')}`);
    }
    if (tablesWithoutAudit.length > 0) {
      console.log(`📝 skip audit: ${tablesWithoutAudit.join(', ')}`);
    }
  }

  // Compile and run template
  const isManualMigration = !hasChanges && options.newMigration;
  const compiledTemplate = Handlebars.compile(template);
  const sqlContent = compiledTemplate({
    tag,
    timestamp,
    diff,
    auditTables,
    isManualMigration,
  });

  // Write SQL file
  const sqlPath = join(DRIZZLE_DIR, `${tag}.sql`);
  writeFileSync(sqlPath, sqlContent);

  // Write snapshot
  const snapshotPath = join(META_DIR, `${nextIdx.toString().padStart(4, '0')}_snapshot.json`);
  writeFileSync(snapshotPath, JSON.stringify(curSnapshot, null, 2));

  // Update journal
  journal.entries.push({
    idx: nextIdx,
    version: '7',
    when: timestamp,
    tag,
    breakpoints: true,
  });
  writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, 2));

  // Update migrations.ts with all migration files
  updateMigrationsTs(journal);

  console.log(`\n✅ Migration file created: ${sqlPath}`);
  console.log(`\n📝 Next steps:`);
  console.log(`   1. Edit the SQL file above and write your migration SQL`);
  console.log(`   2. Run: pnpm db:try-migrate (to test locally)\n`);
}

