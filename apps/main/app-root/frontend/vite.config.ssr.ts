import { defineConfig, mergeConfig } from 'vite'
import baseConfigFn from './vite.config'
import * as path from 'path'

/**
 * SSR build configuration for prerendering.
 * Extends the base vite.config.ts and overrides SSR-specific settings.
 */
export default defineConfig((env) => {
  const baseConfig = baseConfigFn(env)

  return mergeConfig(baseConfig, {
    build: {
      outDir: path.resolve(__dirname, '../dist/ssr'),
      ssr: true,
      rollupOptions: {
        input: path.resolve(__dirname, 'scripts/ssr-entry.tsx'),
        output: {
          entryFileNames: 'ssr-entry.js',
        },
      },
      // Minification not needed for SSR bundle
      minify: false,
      // Generate sourcemaps for debugging
      sourcemap: true,
    },
    // SSR doesn't need dev server config
    server: undefined,
    ssr: {
      // Bundle everything except Node.js built-ins
      noExternal: true,
      // These are Node.js built-in or have native dependencies
      external: ['jsdom'],
    },
  })
})
