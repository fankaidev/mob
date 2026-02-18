/**
 * Database Reset Script
 *
 * This script resets the database migration state and re-applies all migrations.
 * Usage: pnpm db:reset
 *
 * What it does:
 * 1. Drops the drizzle schema (containing __drizzle_migrations table)
 * 2. Drops all tables in public schema
 * 3. Drops all custom types (enums)
 * 4. Re-runs all migrations via drizzle-kit migrate
 */

import 'dotenv/config'
import { neon } from '@neondatabase/serverless'

const DATABASE_URL = process.env.PARAFLOW_DRIZZLE_URL

if (!DATABASE_URL) {
  console.error('Error: PARAFLOW_DRIZZLE_URL environment variable is not set')
  process.exit(1)
}

async function resetDatabase() {
  console.log('🔄 Starting database reset...\n')

  const sql = neon(DATABASE_URL)

  try {
    // Step 0: Drop drizzle schema (contains __drizzle_migrations)
    console.log('🗑️  Dropping drizzle schema (migration tracking)...')
    await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`
    console.log('   Dropped: drizzle schema')

    // Step 1: Get all tables in public schema
    console.log('\n📋 Fetching all tables in public schema...')
    const tables = await sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
    `
    console.log(`   Found ${tables.length} tables: ${tables.map((t) => t.tablename).join(', ') || '(none)'}`)

    // Step 2: Drop all tables with CASCADE
    if (tables.length > 0) {
      console.log('\n🗑️  Dropping all tables...')
      for (const { tablename } of tables) {
        // Use raw SQL string for dynamic table name (neon doesn't support sql() for identifiers)
        await sql(`DROP TABLE IF EXISTS "${tablename}" CASCADE`)
        console.log(`   Dropped: ${tablename}`)
      }
    }

    // Step 3: Get and drop all custom types (enums)
    console.log('\n📋 Fetching custom types...')
    const types = await sql`
      SELECT typname FROM pg_type
      WHERE typtype = 'e'
      AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    `
    console.log(`   Found ${types.length} custom types: ${types.map((t) => t.typname).join(', ') || '(none)'}`)

    if (types.length > 0) {
      console.log('\n🗑️  Dropping custom types...')
      for (const { typname } of types) {
        // Use raw SQL string for dynamic type name
        await sql(`DROP TYPE IF EXISTS "${typname}" CASCADE`)
        console.log(`   Dropped: ${typname}`)
      }
    }

    console.log('\n✅ Database reset complete!')
  } catch (error) {
    console.error('\n❌ Database reset failed:', error)
    process.exit(1)
  }
}

resetDatabase()
