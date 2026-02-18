/**
 * ⚠️ DO NOT use any drizzle-kit commands (generate, migrate, push, etc.)!
 * This config is for IDE tooling only. Use `pnpm codegen` for migrations.
 */
import { defineConfig } from 'drizzle-kit'
import 'dotenv/config'

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  introspect: {
    casing: 'preserve',
  },
  dbCredentials: {
    url: process.env.PARAFLOW_DRIZZLE_URL || '',
  },
})
