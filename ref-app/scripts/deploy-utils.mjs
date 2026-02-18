#!/usr/bin/env node
/**
 * Deployment Utility Script
 *
 * This script handles deployment operations related to directory structure,
 * decoupling GitHub Actions deployment scripts from specific directory layouts.
 *
 * Usage:
 *   node scripts/deploy-utils.mjs <command> [options]
 *
 * Commands:
 *   generate-wrangler    Generate wrangler.jsonc configuration file
 *   generate-drizzle     Generate drizzle.config.ts configuration file
 *   generate-robots      Generate robots.txt based on environment
 *   inject-badge         Inject free user badge into index.html
 *   run-migration        Run database migration
 *   deploy [--dry-run]   Deploy to Cloudflare Workers using build output
 *   get-paths            Output key path information (for CI scripts)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')

// ============ Path Configuration ============
// Centralized management of all directory structure related paths
const PATHS = {
  // Project root directory
  root: PROJECT_ROOT,
  // index.html location
  indexHtml: path.join(PROJECT_ROOT, 'frontend', 'index.html'),
  // Static assets output directory (relative to project root)
  staticDir: 'dist/client',
  // Static assets output directory (absolute path)
  staticDirAbsolute: path.join(PROJECT_ROOT, 'dist', 'client'),
  // Worker entry file (relative to backend directory)
  workerEntry: 'src/app.ts',
  // Schema file path (relative to backend directory)
  schemaPath: './src/schema.ts',
  // Schema output directory (relative to backend directory)
  schemaOutDir: './drizzle',
  // Migration meta directory
  migrationMetaDir: path.join(PROJECT_ROOT, 'backend', 'drizzle', 'meta'),
  // wrangler.jsonc output path (in backend directory)
  wranglerConfig: path.join(PROJECT_ROOT, 'backend', 'wrangler.jsonc'),
  // drizzle.config.ts output path (in backend directory)
  drizzleConfig: path.join(PROJECT_ROOT, 'backend', 'drizzle.config.ts'),
}

// ============ Command Handlers ============

/**
 * Generate wrangler.jsonc configuration file
 */
function generateWrangler() {
  const isProd = process.env.IS_PROD === 'true'
  const appId = process.env.APP_ID
  const branchName = process.env.BRANCH_NAME
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const drizzleUrl = process.env.PARAFLOW_DRIZZLE_URL
  const baseSecrets = JSON.parse(process.env.SECRETS_JSON || '{}')

  if (!appId || !branchName || !accountId) {
    console.error('Error: Missing required environment variables (APP_ID, BRANCH_NAME, CLOUDFLARE_ACCOUNT_ID)')
    process.exit(1)
  }

  const secrets = {
    ...baseSecrets,
    ...(drizzleUrl && { PARAFLOW_DRIZZLE_URL: drizzleUrl }),
  }

  const config = {
    '$schema': 'node_modules/wrangler/config-schema.json',
    name: appId,
    main: PATHS.workerEntry,
    assets: {
      directory: '../' + PATHS.staticDir,
      not_found_handling: '404-page',
      run_worker_first: ['/api/*', '/proxy/*']
    },
    compatibility_date: '2025-12-17',
    compatibility_flags: ['nodejs_compat'],
    observability: {
      enabled: true
    },
    placement: {
      mode: 'smart'
    },
    account_id: accountId,
    env: {
      [branchName]: {
        vars: secrets,
        services: [
          {
            binding: 'PARAFLOW_SERVICE_AUTH',
            service: isProd ? 'paraflow-auth-prod' : 'paraflow-auth-test'
          },
          {
            binding: 'PARAFLOW_SERVICE_AI_GATEWAY',
            service: isProd ? 'ai-gateway-prod' : 'ai-gateway-test'
          },
          {
            binding: 'PARAFLOW_SERVICE_R2',
            service: isProd ? 'r2-proxy-prod' : 'r2-proxy-test'
          }
        ]
      }
    }
  }

  fs.writeFileSync(PATHS.wranglerConfig, JSON.stringify(config, null, 2))
  console.log(`Generated wrangler.jsonc: ${PATHS.wranglerConfig}`)
}

/**
 * Generate drizzle.config.ts configuration file
 */
function generateDrizzle() {
  const content = `import { defineConfig } from 'drizzle-kit'

export default defineConfig({
    schema: '${PATHS.schemaPath}',
    out: '${PATHS.schemaOutDir}',
    dialect: 'postgresql',
    introspect: {
        casing: 'preserve',
    },
    dbCredentials: {
        url: process.env.DRIZZLE_KIT_URL || '',
    },
})
`

  fs.writeFileSync(PATHS.drizzleConfig, content)
  console.log(`Generated drizzle.config.ts: ${PATHS.drizzleConfig}`)
}

/**
 * Generate robots.txt based on environment
 */
function generateRobots() {
  const isProd = process.env.IS_PROD === 'true'
  const clientDir = PATHS.staticDirAbsolute

  if (!fs.existsSync(clientDir)) {
    console.error(`Error: Client directory not found: ${clientDir}`)
    process.exit(1)
  }

  const robotsPath = path.join(clientDir, 'robots.txt')

  const content = isProd
    ? 'User-agent: *\nAllow: /'
    : 'User-agent: *\nDisallow: /'

  fs.writeFileSync(robotsPath, content)
  console.log(`Generated robots.txt (${isProd ? 'production' : 'test'} mode): ${robotsPath}`)
}

/**
 * Inject free user badge into index.html
 */
function injectBadge() {
  const indexPath = PATHS.indexHtml

  if (!fs.existsSync(indexPath)) {
    console.error(`Error: Cannot find index.html: ${indexPath}`)
    process.exit(1)
  }

  let html = fs.readFileSync(indexPath, 'utf-8')

  if (!/<\/body>/i.test(html)) {
    console.error('Error: Cannot find </body> tag in index.html')
    process.exit(1)
  }

  const badgeScript = '<script src="https://static.paraflowcontent.com/public/static-video/9626b95e-a970-446b-960f-711b53bc9100.js"></script>'
  html = html.replace(/<\/body>/i, badgeScript + '</body>')

  fs.writeFileSync(indexPath, html)
  console.log(`Injected free user badge into: ${indexPath}`)
}

/**
 * Run database migration
 */
function runMigration() {
  const drizzleKitUrl = process.env.DRIZZLE_KIT_URL

  if (!drizzleKitUrl) {
    console.error('Error: Missing DRIZZLE_KIT_URL environment variable')
    process.exit(1)
  }

  if (!fs.existsSync(PATHS.migrationMetaDir)) {
    console.log(`Skipping migration: ${PATHS.migrationMetaDir} directory does not exist`)
    return
  }

  try {
    console.log('Running database migration...')
    // Run drizzle-kit migrate in backend directory
    execSync('pnpm drizzle-kit migrate', {
      cwd: path.join(PROJECT_ROOT, 'backend'),
      stdio: 'inherit',
      env: {
        ...process.env,
        DRIZZLE_KIT_URL: drizzleKitUrl
      }
    })
    console.log('Database migration completed')
  } catch (error) {
    console.error('Error: Database migration failed')
    process.exit(1)
  }
}

/**
 * Output key path information (for CI scripts)
 */
function getPaths() {
  const output = {
    indexHtml: path.relative(PROJECT_ROOT, PATHS.indexHtml),
    staticDir: PATHS.staticDir,
    workerEntry: PATHS.workerEntry,
    schemaPath: PATHS.schemaPath,
    schemaOutDir: PATHS.schemaOutDir,
    migrationMetaDir: path.relative(PROJECT_ROOT, PATHS.migrationMetaDir),
    hasMigrationMeta: fs.existsSync(PATHS.migrationMetaDir)
  }
  console.log(JSON.stringify(output, null, 2))
}

/**
 * Deploy to Cloudflare Workers using the vite build output
 * 
 * Environment variables:
 *   - CLOUDFLARE_API_TOKEN: Cloudflare API token
 *   - CLOUDFLARE_ACCOUNT_ID: Cloudflare account ID
 *   - DISPATCH_NAMESPACE: Dispatch namespace (optional)
 */
function deploy() {
  const distDir = path.join(PROJECT_ROOT, 'dist')
  
  // Find the build output directory (contains wrangler.json)
  const buildDirs = fs.readdirSync(distDir).filter(name => {
    const dir = path.join(distDir, name)
    return fs.statSync(dir).isDirectory() && 
           fs.existsSync(path.join(dir, 'wrangler.json')) &&
           name !== 'client'
  })
  
  if (buildDirs.length === 0) {
    console.error('Error: No build output directory found. Please run build first.')
    process.exit(1)
  }
  
  const buildOutputDir = path.join(distDir, buildDirs[0])
  console.log(`Using build output: ${buildOutputDir}`)
  
  // Copy frontend assets to build output
  const clientDir = path.join(distDir, 'client')
  const targetClientDir = path.join(buildOutputDir, 'client')
  
  console.log(`Frontend assets source: ${clientDir}`)
  console.log(`Frontend assets target: ${targetClientDir}`)
  
  if (!fs.existsSync(clientDir)) {
    console.error(`Error: Frontend assets not found at ${clientDir}`)
    console.error('Please ensure frontend build completed successfully.')
    process.exit(1)
  }
  
  if (!fs.existsSync(targetClientDir)) {
    console.log('Copying frontend assets...')
    execSync(`cp -r "${clientDir}" "${targetClientDir}"`, { stdio: 'inherit' })
    console.log('Frontend assets copied successfully')
  } else {
    console.log('Frontend assets already exist in target directory')
  }
  
  // Verify client directory exists
  if (!fs.existsSync(targetClientDir)) {
    console.error(`Error: Failed to copy frontend assets to ${targetClientDir}`)
    process.exit(1)
  }
  
  // Update wrangler.json to include assets
  const wranglerJsonPath = path.join(buildOutputDir, 'wrangler.json')
  const wranglerConfig = JSON.parse(fs.readFileSync(wranglerJsonPath, 'utf-8'))
  if (!wranglerConfig.assets) {
    wranglerConfig.assets = {
      directory: './client',
      not_found_handling: '404-page',
      run_worker_first: ['/api/*', '/proxy/*']
    }
    fs.writeFileSync(wranglerJsonPath, JSON.stringify(wranglerConfig, null, 2))
    console.log('Updated wrangler.json with assets configuration')
  }
  
  // Build wrangler deploy command
  const dispatchNamespace = process.env.DISPATCH_NAMESPACE
  const isDryRun = process.argv.includes('--dry-run')
  let deployCmd = 'npx wrangler deploy'
  if (dispatchNamespace) {
    deployCmd += ` --dispatch-namespace ${dispatchNamespace}`
  }
  if (isDryRun) {
    deployCmd += ' --dry-run'
  }
  
  console.log(`Running: ${deployCmd}`)
  
  // Run wrangler deploy in the build output directory
  try {
    execSync(deployCmd, {
      cwd: buildOutputDir,
      stdio: 'inherit',
      env: process.env
    })
    console.log('Deployment completed successfully')
  } catch (error) {
    console.error('Error: Deployment failed')
    process.exit(1)
  }
}

// ============ Main Program ============

const command = process.argv[2]

const commands = {
  'generate-wrangler': generateWrangler,
  'generate-drizzle': generateDrizzle,
  'generate-robots': generateRobots,
  'inject-badge': injectBadge,
  'run-migration': runMigration,
  'get-paths': getPaths,
  'deploy': deploy,
}

if (!command || !commands[command]) {
  console.log(`
Deployment Utility Script

Usage:
  node scripts/deploy-utils.mjs <command>

Available Commands:
  generate-wrangler    Generate wrangler.jsonc configuration file
  generate-drizzle     Generate drizzle.config.ts configuration file
  generate-robots      Generate robots.txt based on IS_PROD env (test: disallow, prod: allow)
  inject-badge         Inject free user badge into index.html
  run-migration        Run database migration
  deploy [--dry-run]   Deploy to Cloudflare Workers using build output
  get-paths            Output key path information (JSON format)

Environment Variables:
  generate-wrangler requires:
    - APP_ID                    Application ID
    - BRANCH_NAME               Branch name
    - CLOUDFLARE_ACCOUNT_ID     Cloudflare account ID
    - IS_PROD                   Whether production environment (true/false)
    - PARAFLOW_DRIZZLE_URL      Database connection URL (optional)
    - SECRETS_JSON              Additional secrets as JSON (optional)

  generate-robots requires:
    - IS_PROD                   Whether production environment (true/false)

  run-migration requires:
    - DRIZZLE_KIT_URL           Database connection URL

  deploy requires:
    - CLOUDFLARE_API_TOKEN      Cloudflare API token
    - CLOUDFLARE_ACCOUNT_ID     Cloudflare account ID
    - DISPATCH_NAMESPACE        Dispatch namespace (optional)
`)
  process.exit(command ? 1 : 0)
}

commands[command]()

