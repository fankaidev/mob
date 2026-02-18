import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import path from 'path'
import compression from 'vite-plugin-compression2'
import Handlebars from 'handlebars'

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

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'

  return {
    server: {
      port: 8787,
      strictPort: true,
      allowedHosts: true,
    },
    build: {
      outDir: path.resolve(__dirname, '../dist'),
      sourcemap: 'hidden',
      rollupOptions: {
        output: {
          // Inline all dynamic imports into a single bundle.
          // Cloudflare Workers can fail to resolve chunk modules created by code splitting.
          inlineDynamicImports: true,
        },
      },
    },
    plugins: [
      handlebarsPrecompile(),
      // Cloudflare Vite plugin for development and build
      cloudflare({
        inspectorPort: false,
        configPath: path.resolve(__dirname, 'wrangler.jsonc'),
      }),
      // Brotli compression for production builds
      isProduction &&
        compression({
          algorithms: ['brotliCompress'],
          include: [/\.(js|css)$/],
          exclude: [/\.(br)$/, /\.(gz)$/],
          deleteOriginalAssets: false,
        }),
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@backend': path.resolve(__dirname, 'src'),
        // Force turndown to use browser ES build (no require() calls)
        // The node build uses require('@mixmark-io/domino') which fails in Workers
        'turndown': path.resolve(__dirname, 'node_modules/turndown/lib/turndown.browser.es.js'),
      },
    },
  }
})
