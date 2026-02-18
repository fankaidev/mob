#!/usr/bin/env node
/**
 * Prerender Script
 *
 * Generates static HTML files for each static route using the SSR bundle.
 * Uses the production SSR build (dist/ssr/ssr-entry.js) for consistent
 * code transformation with the client bundle.
 *
 * Usage:
 *   pnpm prerender
 *
 * Prerequisites:
 *   1. Run `vite build` to generate client bundle
 *   2. Run `vite build --config vite.config.ssr.ts` to generate SSR bundle
 */

import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import { setupBrowserMock } from './utils/browser-mock'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Path configuration
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')  // demo/
const DIST_CLIENT = path.join(PROJECT_ROOT, 'dist', 'client')
const DIST_SSR = path.join(PROJECT_ROOT, 'dist', 'ssr')
const SSR_ENTRY = path.join(DIST_SSR, 'ssr-entry.js')

// Convert URL path to output file path
function getOutputPath(url: string): string {
  if (url === '/') return path.join(DIST_CLIENT, 'index.html')
  return path.join(DIST_CLIENT, ...url.split('/').filter(Boolean), 'index.html')
}

async function prerender() {
  console.log('Starting prerender with SSR bundle...')

  // Check if client dist exists
  if (!fs.existsSync(DIST_CLIENT)) {
    console.error(`Error: Client build not found at ${DIST_CLIENT}`)
    console.error('Please run "vite build" first')
    process.exit(1)
  }

  // Check if SSR bundle exists
  if (!fs.existsSync(SSR_ENTRY)) {
    console.error(`Error: SSR bundle not found at ${SSR_ENTRY}`)
    console.error('Please run "vite build --config vite.config.ssr.ts" first')
    process.exit(1)
  }

  const templatePath = path.join(DIST_CLIENT, 'index.html')
  if (!fs.existsSync(templatePath)) {
    console.error(`Error: index.html not found at ${templatePath}`)
    process.exit(1)
  }

  const template = fs.readFileSync(templatePath, 'utf-8')

  // Copy original index.html as 404.html (SPA fallback for dynamic routes)
  const fallbackPath = path.join(DIST_CLIENT, '404.html')
  fs.writeFileSync(fallbackPath, template)
  console.log(`Generated 404.html (SPA fallback): ${fallbackPath}`)

  // Setup browser globals BEFORE importing SSR bundle
  setupBrowserMock()

  // Import the SSR bundle (production build)
  const ssrEntry = await import(SSR_ENTRY) as typeof import('./ssr-entry')

  const staticPaths = await ssrEntry.getStaticPaths()
  console.log(`Found ${staticPaths.length} static routes to prerender`)

  for (const url of staticPaths) {
    try {
      console.log(`Prerendering: ${url}`)
      const content = await ssrEntry.prerenderUrl(url)

      const outputPath = getOutputPath(url)
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.writeFileSync(outputPath, template.replace(
        /<div id="bundler-root"><\/div>/,
        `<div id="bundler-root">${content}</div>`
      ))
      console.log(`  -> ${outputPath}`)
    } catch (error) {
      console.error(`Error prerendering ${url}:`, error)
    }
  }

  console.log('Prerender completed!')

  // Force exit - JSDOM may keep timers/listeners alive
  process.exit(0)
}

prerender()
