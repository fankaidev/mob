import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import * as path from 'path'
import * as fs from 'fs'
import Handlebars from 'handlebars'
import { browserPrototypePlugin } from './vite-plugins/browserPrototypePlugin'

function handlebarsPrecompile() {
  return {
    name: 'handlebars-precompile',
    transform(code: string, id: string) {
      if (id.endsWith('.hbs')) {
        const precompiled = Handlebars.precompile(code)
        return {
          code: `export default ${precompiled};`,
          map: null
        }
      }
    }
  }
}

const sentryOrg = process.env.SENTRY_ORG
const sentryProject = process.env.SENTRY_PROJECT
const sentryRelease = process.env.VITE_SENTRY_RELEASE

// Read FAST_PROTOTYPE_MODE from JSON file
const prototypeModePath = path.resolve(__dirname, './src/IS_FAST_PROTOTYPE_MODE.json')
const fastPrototypeMode = fs.existsSync(prototypeModePath) && JSON.parse(fs.readFileSync(prototypeModePath, 'utf-8')) === true

export default defineConfig(() => {

  const plugins = [
    react(),
    tailwindcss(),
    handlebarsPrecompile(),
    browserPrototypePlugin({ fastPrototypeMode }),
  ]

  plugins.push(
    sentryVitePlugin({
      org: sentryOrg,
      project: sentryProject,
      release: { name: sentryRelease },
    })
  )

  return {
    build: {
      outDir: path.resolve(__dirname, '../dist/client'),
      sourcemap: true,
    },
    plugins,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@frontend': path.resolve(__dirname, '../frontend/src'),
        '@backend': path.resolve(__dirname, '../backend/src'),
        'txom-frontend-libs': path.resolve(__dirname, '../txom-frontend-libs/src')
      },
    },
    server: {
      port: 3000,
      strictPort: true,
      allowedHosts: true,
      // Disable proxy in FAST_PROTOTYPE_MODE (API is handled in-browser)
      proxy: fastPrototypeMode
        ? undefined
        : {
          '/api': {
            target: 'http://localhost:8787',
            changeOrigin: true,
          },
          '/proxy': {
            target: 'http://localhost:8787',
            changeOrigin: true,
          },
        },
    },
    // PGLite requires exclusion from Vite's dependency optimization
    // because it has special WASM loading logic
    optimizeDeps: {
      exclude: ['@electric-sql/pglite'],
    },
  }
})
