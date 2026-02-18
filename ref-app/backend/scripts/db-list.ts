import 'dotenv/config'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.PARAFLOW_DRIZZLE_URL!)

async function listDatabase() {
  console.log('=== Tables ===')
  const tables = await sql`
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `
  console.table(tables)

  console.log('\n=== Enums ===')
  const enums = await sql`
    SELECT t.typname as enum_name,
           string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) as values
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname
  `
  console.table(enums)

  console.log('\n=== Partitions ===')
  const partitions = await sql`
    SELECT parent.relname as parent_table, c.relname as partition_name
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class parent ON parent.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    ORDER BY parent.relname, c.relname
  `
  console.table(partitions.length ? partitions : [{ message: 'No partitions found' }])

  console.log('\n=== Triggers ===')
  const triggers = await sql`
    SELECT trigger_name, event_object_table, event_manipulation
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table, trigger_name
  `
  console.table(triggers.length ? triggers : [{ message: 'No triggers found' }])

  console.log('\n=== Functions ===')
  const functions = await sql`
    SELECT routine_name, routine_type
    FROM information_schema.routines
    WHERE routine_schema = 'public'
    ORDER BY routine_name
  `
  console.table(functions.length ? functions : [{ message: 'No functions found' }])

  console.log('\n=== Indexes ===')
  const indexes = await sql`
    SELECT tablename, indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `
  console.table(indexes)
}

listDatabase()
