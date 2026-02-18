import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'
import authIntegrationCheck from '../eslint-rules/auth-integration-check.js'
import noToplevelDate from './eslint-rules/no-toplevel-date.cjs'

export default tseslint.config([
  globalIgnores(['dist', 'drizzle', 'src/lib/just-bash']),
  // Base config for all TypeScript files
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
    },
    plugins: {
      'local': { rules: { 'auth-integration-check': authIntegrationCheck } }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // Checks auth integration completeness
      'local/auth-integration-check': 'error',
      // Forbid .where(sql`...`) - use Drizzle's eq/and/or helpers instead
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name="where"] > TaggedTemplateExpression[tag.name="sql"]',
          message: 'Do not use .where(sql`...`). Use Drizzle\'s eq(), and(), or(), gt(), lt() helpers instead. Example: .where(eq(table.column, value))'
        }
      ],
    },
  },
  // Cloudflare Workers specific: only check src/** (runs in Workers runtime)
  {
    files: ['src/**/*.ts'],
    plugins: {
      custom: { rules: { 'no-toplevel-date': noToplevelDate } }
    },
    rules: {
      // Forbid new Date() and Date.now() at module top-level (returns epoch 0 in Cloudflare Workers)
      'custom/no-toplevel-date': 'error'
    },
  }
])
