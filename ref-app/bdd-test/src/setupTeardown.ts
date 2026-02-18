
import { vi, beforeAll, afterAll, beforeEach, afterEach, expect } from 'vitest'
import { createApp } from '@backend/app'
import { fakeGateways, resetDatabaseForTest, aiFake, r2Fake, authFake, dbFake, getPgliteClientForTest } from '@backend/infra/gateway/fake'
import { TEST_BASE_TIME, store, cleanupRender } from './helper'
import { getTestEnv } from './setupTestEnv'
import { validateSchemaMigrationConsistency } from './validation/schemaValidator'
import * as backendSchema from '@backend/schema'



// Get test app with injected fake gateways (no vi.mock needed)
const app = createApp(fakeGateways)

/**
 * Cookie storage for test environment.
 * Since we're not in a real browser, we need to manually manage cookies.
 * Map: testFileId -> cookie string
 */
const testCookieStore = new Map<string, string>()

/**
 * Get a stable test file ID for database sharing.
 * All tests in the same file share one database instance.
 *
 * Optimization: reduces DB instances from 36 (per test) to 6 (per file)
 * This saves ~83% of database initialization time.
 */
const getTestFileId = (): string => {
  const testPath = expect.getState().testPath
  if (!testPath) {
    // Fallback to test name if path not available
    return expect.getState().currentTestName || 'unknown'
  }
  // Use file path as stable ID (e.g., "tests/store/pollster/poll.test.ts")
  return testPath.replace(/^.*\/tests\//, 'tests/')
}

/**
 * Parse Set-Cookie header and extract cookie value
 */
const parseSetCookie = (setCookie: string): { name: string; value: string } | null => {
  const match = setCookie.match(/^([^=]+)=([^;]*)/)
  if (!match) return null
  return { name: match[1], value: match[2] }
}

/**
 * Helper function to create a fetch that routes API requests to Hono
 * and other requests to the original fetch
 */
const createApiRoutingFetch = (originalFetch: typeof fetch) => {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

    // In test environment, prepend origin to relative URLs (fetch doesn't auto-resolve like browsers)
    if (url.startsWith('/')) {
      url = `${window.location.origin}${url}`
    }

    // Route /api/* requests to Hono backend
    if (url.includes('/api/')) {
      // Use file-level ID instead of test-level ID for DB sharing
      const testId = getTestFileId()

      const request = new Request(url, init)
      request.headers.set('x-test-id', testId)

      // Add stored cookies to request (simulate browser cookie behavior)
      const storedCookie = testCookieStore.get(testId)
      if (storedCookie) {
        request.headers.set('Cookie', storedCookie)
      }

      const response = await app.fetch(request, getTestEnv(), {
        waitUntil: (p: Promise<unknown>) => { p.catch(() => {}) },
        passThroughOnException: () => {},
        props: {},
      })

      // Detect unregistered backend routes via HONO_ROUTE_NOT_FOUND marker
      if (response.status === 404) {
        const clonedResponse = response.clone()
        const body = await clonedResponse.json().catch(() => null) as { error?: string; path?: string } | null
        if (body?.error === 'HONO_ROUTE_NOT_FOUND') {
          return new Response(
            JSON.stringify({ error: `Backend route not registered: ${body.path}` }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          )
        }
      }

      // Extract and store Set-Cookie header (simulate browser cookie storage)
      const setCookie = response.headers.get('Set-Cookie')
      if (setCookie) {
        const parsed = parseSetCookie(setCookie)
        if (parsed) {
          if (parsed.value === '' || setCookie.includes('Max-Age=0')) {
            // Cookie is being cleared
            testCookieStore.delete(testId)
          } else {
            // Store the cookie
            testCookieStore.set(testId, `${parsed.name}=${parsed.value}`)
          }
        }
      }

      return response
    }

    // All other requests use the original fetch
    return originalFetch(input as RequestInfo | URL, init)
  }) as typeof fetch
}

let originalFetch: typeof fetch

// Exit module initialization phase when setupTeardown loads
// Note: Cannot delay further because PGLite and other deps need real Date
// But test files' imports still run under epoch 0 (before setupFiles execute)
const epochZeroPreload = (globalThis as any).__epochZeroPreload
if (epochZeroPreload) {
  epochZeroPreload.exitModuleInitPhase()
  epochZeroPreload.restoreOriginalDate()
}

beforeAll(async () => {
  // Enable React act environment for proper error handling
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

  // Setup fake timers globally
  vi.useFakeTimers({
    shouldAdvanceTime: true,
  })
  vi.setSystemTime(TEST_BASE_TIME)

  originalFetch = globalThis.fetch
  const newFetch = createApiRoutingFetch(originalFetch)
  vi.stubGlobal('fetch', newFetch)

  // Validate schema-migration consistency once at startup
  // This catches cases where schema.ts was modified but migration SQL wasn't updated
  const client = await getPgliteClientForTest('schema-validation')
  await validateSchemaMigrationConsistency(client, backendSchema as Record<string, unknown>)
})

// Test user credentials
// Admin user is seeded in beforeEach via SQL
// Regular users are registered via RegisterStore
const TEST_ADMIN = { id: '10000000-0000-4000-8000-000000000001', name: 'admin', email: 'admin@test.com', password: 'paraflow123456' }
const TEST_USERS = [
  TEST_ADMIN,
  { name: 'regular', email: 'regular-a@test.com', password: 'regular123456' },
  { name: 'regularB', email: 'regular-b@test.com', password: 'regular123456' },
]

async function registerTestUsers() {


}

// Clean database before each test to ensure isolation
beforeEach(async () => {
  // Reset Jotai store to ensure clean state between tests
  store.reset()

  // Reset fake time to base time for each test
  vi.setSystemTime(TEST_BASE_TIME)

  const testId = getTestFileId()

  // Clear cookies for this test file
  testCookieStore.delete(testId)
  await resetDatabaseForTest(testId)

  // Reset fakes to default behavior for test isolation.
  // dbFake.reset() sets the testId used by createDbClient() for subsequent
  // database operations routed through the Hono app.
  dbFake.reset(testId)
  aiFake.reset()
  r2Fake.reset()
  authFake.reset(testId)

  // Seed admin user into database (not in migration SQL to keep production clean)
  // Skip if users table doesn't exist (schema may not include it)
  const client = await getPgliteClientForTest(testId)
  const tableCheck = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') as exists`
  )
  if (tableCheck.rows[0]?.exists) {
    await client.query(
      `INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, 'admin') ON CONFLICT (id) DO NOTHING`,
      [TEST_ADMIN.id, TEST_ADMIN.email, TEST_ADMIN.name]
    )
  }

  // Register test users (syncs with auth fake)
  await registerTestUsers()
})

// Clean up React render to prevent "window is not defined" errors
afterEach(() => {
  cleanupRender()
})

afterAll(() => {
  vi.useRealTimers()
  vi.stubGlobal('fetch', originalFetch)
})
