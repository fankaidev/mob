import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs, { readFileSync } from 'node:fs'
import Handlebars from 'handlebars'

// Read FAST_PROTOTYPE_MODE from JSON file (same logic as frontend vite.config.ts)
const prototypeModePath = path.join(__dirname, '../frontend/src/IS_FAST_PROTOTYPE_MODE.json')
const fastPrototypeMode = fs.existsSync(prototypeModePath) && JSON.parse(fs.readFileSync(prototypeModePath, 'utf-8')) === true

function handlebarsPrecompile() {
  return {
    name: 'handlebars-precompile',
    enforce: 'pre' as const,
    load(id: string) {
      if (id.endsWith('.hbs')) {
        // Read and precompile the template
        const code = readFileSync(id, 'utf-8')
        const precompiled = Handlebars.precompile(code)
        return {
          code: `export default ${precompiled};`,
          map: null
        }
      }
    }
  }
}

export default defineConfig({
  plugins: [react(), handlebarsPrecompile()],
  resolve: {
    preserveSymlinks: false,
    alias: {
      // Frontend @/ alias points to frontend/src (used in App.tsx and other frontend code)
      '@/': path.resolve(__dirname, '../frontend/src/'),
      '@': path.resolve(__dirname, '../frontend/src'),
      '@frontend': path.resolve(__dirname, '../frontend/src'),
      '@backend': path.resolve(__dirname, '../backend/src'),
      '@bdd-test': path.resolve(__dirname, './src'),
      'txom-frontend-libs': path.resolve(__dirname, '../txom-frontend-libs/src')
    },
    dedupe: ['react', 'react-dom'],
    conditions: ['import', 'module', 'browser', 'default'],
  },
  assetsInclude: ['**/*.hbs'],
  server: {
    fs: {
      // Allow access to the entire workspace including node_modules
      allow: [path.resolve(__dirname, '../../')],
    },
  },
  test: {
    reporters: 'default',
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:3000/'
      }
    },
    pool: 'forks',
    execArgv: ['--enable-source-maps', '--import', `file://${path.join(__dirname, './preloadEpochZero.mjs')}`],
    testTimeout: 10_000,
    hookTimeout: 30_000,
    allowEmpty: true,
    setupFiles: ['vitest-localstorage-mock', path.join(__dirname, './src/setupTeardown.ts')],
    env: {
      PARAFLOW_APP_ID: 'test-app-id',
      PARAFLOW_AUTH_API_URL: 'http://localhost:3000/api/auth',
      PARAFLOW_AI_GATEWAY_TOKEN: 'test-ai-token',
      PARAFLOW_AI_GATEWAY_OPENAI_BASE_URL: 'https://mock-ai-gateway.test',
      ...(fastPrototypeMode ? { VITE_FAST_PROTOTYPE_MODE: '1' } : {}),
    },
    server: {
      deps: {
        // Force inline symlinked dependencies to avoid React multiple instances
        inline: [
          /@radix-ui/,
          /react-remove-scroll/,
          /sonner/,
          /class-variance-authority/,
          /lucide-react/,
          /vaul/,
          /cmdk/,
          /input-otp/,
          /tw-animate-css/,
          /react-day-picker/,
          /react-resizable-panels/,
          /embla-carousel-react/,
          /recharts/,
          /echarts-for-react/,
        ],
      },
    },
    deps: {
      optimizer: {
        client: {
          enabled: true,
          include: [
            'react',
            'react-dom',
          ],
        },
      },
    },
    include: [path.join(__dirname, './tests/**/*.test.ts')],
  },
})
