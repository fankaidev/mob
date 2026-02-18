/**
 * Migration Validator
 *
 * Shared validation logic for Drizzle migrations.
 * Used by both db:try-migrate script and test infrastructure.
 */

import path from 'node:path'
import { readFileSync, existsSync, readdirSync } from 'node:fs'

export interface JournalEntry {
  idx: number
  version: string
  when: number
  tag: string
  breakpoints: boolean
}

export interface Journal {
  version: string
  dialect: string
  entries: JournalEntry[]
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Get the drizzle directory path
 */
export function getDrizzleDir(): string {
  // Works from both src/lib and scripts directories
  const possiblePaths = [
    path.resolve(__dirname, '../../drizzle'),      // from src/lib
    path.resolve(__dirname, '../drizzle'),         // from scripts (compiled)
  ]

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p
    }
  }

  // Default fallback
  return path.resolve(__dirname, '../../drizzle')
}

/**
 * Validate journal entries have corresponding snapshot and SQL files.
 * Also checks for orphan snapshot files.
 */
export function validateJournalSnapshotConsistency(drizzleDir?: string): ValidationResult {
  const dir = drizzleDir ?? getDrizzleDir()
  const errors: string[] = []
  const metaDir = path.join(dir, 'meta')
  const journalPath = path.join(metaDir, '_journal.json')

  if (!existsSync(journalPath)) {
    errors.push('Missing _journal.json file in drizzle/meta/')
    return { valid: false, errors }
  }

  let journal: Journal
  try {
    journal = JSON.parse(readFileSync(journalPath, 'utf-8'))
  } catch {
    errors.push('Failed to parse _journal.json')
    return { valid: false, errors }
  }

  for (const entry of journal.entries) {
    const snapshotFile = `${entry.idx.toString().padStart(4, '0')}_snapshot.json`
    const snapshotPath = path.join(metaDir, snapshotFile)
    const sqlFile = `${entry.tag}.sql`
    const sqlPath = path.join(dir, sqlFile)

    // Check snapshot exists
    if (!existsSync(snapshotPath)) {
      errors.push(`Journal entry ${entry.idx} (${entry.tag}): missing snapshot file ${snapshotFile}`)
    }

    // Check SQL file exists
    if (!existsSync(sqlPath)) {
      errors.push(`Journal entry ${entry.idx} (${entry.tag}): missing SQL file ${sqlFile}`)
    }
  }

  // Check for orphan snapshot files (snapshots without journal entries)
  if (existsSync(metaDir)) {
    const snapshotFiles = readdirSync(metaDir).filter(
      (f) => f.endsWith('_snapshot.json') && f !== '_journal.json'
    )
    const journalIndexes = new Set(journal.entries.map((e) => e.idx))

    for (const snapshotFile of snapshotFiles) {
      const match = snapshotFile.match(/^(\d+)_snapshot\.json$/)
      if (match) {
        const idx = parseInt(match[1], 10)
        if (!journalIndexes.has(idx)) {
          errors.push(`Orphan snapshot file ${snapshotFile}: no matching journal entry`)
        }
      }
    }
  }

  // Check for orphan SQL files (SQL files without journal entries)
  // This catches cases where someone manually created a SQL file without using pnpm codegen
  const journalTags = new Set(journal.entries.map((e) => e.tag))
  const sqlFiles = readdirSync(dir).filter((f) => f.endsWith('.sql'))

  for (const sqlFile of sqlFiles) {
    const tag = sqlFile.replace('.sql', '')
    if (!journalTags.has(tag)) {
      errors.push(`Orphan SQL file ${sqlFile}: no matching journal entry. Run "pnpm codegen" to generate proper migration files.`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Generate detailed guidance for creating a proper data migration.
 * Called when validation fails to help developers fix the issue.
 */
export function getDataMigrationGuide(lastIdx?: number): string {
  const nextIdx = (lastIdx ?? 0) + 1
  const paddedIdx = nextIdx.toString().padStart(4, '0')

  return `
================================================================================
How to Fix Migration File Consistency Errors
================================================================================

Migration files require THREE components to be consistent:

1. SQL File:        drizzle/${paddedIdx}_xxx.sql
2. Snapshot File:   drizzle/meta/${paddedIdx}_snapshot.json
3. Journal Entry:   drizzle/meta/_journal.json

How to Fix:
-----------

Always use "pnpm codegen" to generate migration files:

  pnpm codegen

This command will:
- Compare your schema.ts with the last snapshot
- Generate the SQL file with proper naming
- Create the snapshot file automatically
- Update the journal entry

For Data-Only Migrations (INSERT/UPDATE/DELETE):
------------------------------------------------

1. Run "pnpm codegen" first (even if no schema changes)
2. Edit the generated SQL file to add your data statements
3. Run "pnpm db:try-migrate" to verify

DO NOT manually create migration files - always use pnpm codegen to ensure
all three components (SQL, snapshot, journal) are properly synchronized.

================================================================================
`
}

/**
 * Get the last journal entry index, or -1 if no entries exist
 */
export function getLastJournalIdx(drizzleDir?: string): number {
  const dir = drizzleDir ?? getDrizzleDir()
  const journalPath = path.join(dir, 'meta', '_journal.json')

  if (!existsSync(journalPath)) {
    return -1
  }

  try {
    const journal: Journal = JSON.parse(readFileSync(journalPath, 'utf-8'))
    if (journal.entries.length === 0) {
      return -1
    }
    return Math.max(...journal.entries.map((e) => e.idx))
  } catch {
    return -1
  }
}
