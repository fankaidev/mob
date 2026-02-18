import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import unusedImports from 'eslint-plugin-unused-imports'
import importPlugin from 'eslint-plugin-import'
import { globalIgnores } from 'eslint/config'
import path from 'path'
import { fileURLToPath } from 'url'
import requirePageLinks from './eslint-rules/require-page-links.js'
import requireHomePageLink from './eslint-rules/require-home-page-link.js'
import requirePagelinksInRoutes from './eslint-rules/require-pagelinks-in-routes.js'
import authIntegrationCheck from '../eslint-rules/auth-integration-check.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default tseslint.config([
  globalIgnores(['dist', 'src/lib/pi-ai', 'src/lib/pi-agent', 'src/lib/just-bash']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'unused-imports': unusedImports,
      'import': importPlugin,
      'local': { rules: { 'require-page-links': requirePageLinks, 'require-home-page-link': requireHomePageLink, 'require-pagelinks-in-routes': requirePagelinksInRoutes, 'auth-integration-check': authIntegrationCheck } }
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: [path.resolve(__dirname, './tsconfig.json')]
        },
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx']
        }
      }
    },
    rules: {
      'unused-imports/no-unused-imports': 'off',
      'unused-imports/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // Import path validation (ignore virtual: modules from Vite)
      'import/no-unresolved': ['error', { ignore: ['^virtual:'] }],
      'import/named': 'error',
      'import/default': 'error',
      'import/namespace': 'error',
      'import/no-absolute-path': 'error',
      'import/no-extraneous-dependencies': 'off',
      // Require pageLinks for Link and navigate (auto-fixable)
      'local/require-page-links': 'error',
      // Require at least one non-shortcut pageLink returning '/' for global_shortcut_home
      'local/require-home-page-link': 'error',
      // Require all pageLinks to be registered in routes
      'local/require-pagelinks-in-routes': 'error',
      // Checks auth integration completeness
      'local/auth-integration-check': 'error',
      // Prevent usage of native modals - use shadcn components instead
      // Using no-restricted-globals to only catch global window.alert/confirm/prompt
      // This won't false-positive on local variables named 'confirm' etc.
      'no-restricted-globals': [
        'error',
        {
          name: 'alert',
          message: 'Use toast from @/components/ui/toaster instead of alert(). Native modals have ugly UI and are disabled in iframe/canvas mode.'
        },
        {
          name: 'confirm',
          message: 'Use ConfirmDialog or toast instead of confirm(). Native modals have ugly UI and are disabled in iframe/canvas mode.'
        },
        {
          name: 'prompt',
          message: 'Use a custom input dialog instead of prompt(). Native modals have ugly UI and are disabled in iframe/canvas mode.'
        }
      ],
      // Still catch explicit window.alert/confirm/prompt calls
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.object.name="window"][callee.property.name="alert"]',
          message: 'Use toast from @/components/ui/toaster instead of window.alert(). Native modals have ugly UI and are disabled in iframe/canvas mode.'
        },
        {
          selector: 'CallExpression[callee.object.name="window"][callee.property.name="confirm"]',
          message: 'Use ConfirmDialog or toast instead of window.confirm(). Native modals have ugly UI and are disabled in iframe/canvas mode.'
        },
        {
          selector: 'CallExpression[callee.object.name="window"][callee.property.name="prompt"]',
          message: 'Use a custom input dialog instead of window.prompt(). Native modals have ugly UI and are disabled in iframe/canvas mode.'
        }
      ]
    }
  },
  // Disable react-refresh for components (UI and custom) and storybook
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/storybook/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off'
    }
  },
  // Enable React hooks with proper linting
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    }
  },
])

