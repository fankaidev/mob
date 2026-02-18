import type { Plugin } from 'vite'
import * as path from 'path'

interface BrowserPrototypePluginOptions {
  fastPrototypeMode: boolean
}

/**
 * Browser prototype plugin for handling fast prototype mode configurations
 *
 * In fast prototype mode:
 * - Replaces @sentry/cloudflare with browser-compatible shim
 * - Allows bundling prototype directory (which contains @backend/app)
 *
 * In production mode:
 * - Uses real @sentry/cloudflare
 * - Excludes prototype directory from bundle
 */
export function browserPrototypePlugin(options: BrowserPrototypePluginOptions): Plugin {
  const { fastPrototypeMode } = options

  return {
    name: 'browser-prototype-plugin',
    config() {
      return {
        resolve: {
          alias: {
            // In FAST_PROTOTYPE_MODE, replace @sentry/cloudflare with browser-compatible shim
            ...(fastPrototypeMode && {
              '@sentry/cloudflare': path.resolve(__dirname, './sentryCloudflareShim.ts'),
            }),
          },
        },
        build: {
          rollupOptions: {
            // In production build (non-prototype), exclude prototype directory
            // to avoid bundling @backend/app which requires @sentry/cloudflare
            external: fastPrototypeMode ? [] : [/\/prototype\//],
          },
        },
      }
    },
  }
}
