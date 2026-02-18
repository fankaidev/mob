/**
 * Browser Prototype Mode Initialization.
 *
 * This module initializes the browser prototype mode:
 * 1. Initializes PGLite (WASM PostgreSQL)
 * 2. Creates the Hono app with browser gateways
 * 3. Intercepts fetch() to route /api/* requests to the in-browser Hono app
 * 4. Manually manages session tokens (since Set-Cookie doesn't work without real HTTP)
 *
 * This enables running the full stack (frontend + backend + database) entirely in the browser.
 */
import { getBrowserPglite } from './browserPglite'
import { authFake, PROTOTYPE_ADMIN_TOKEN } from '@backend/infra/gateway/fake/authClient'
import type { Hono } from 'hono'
import { initBrowserPglite } from './browserPglite'
import { createBrowserApp } from './browserApp'
import { tokenStorage } from 'txom-frontend-libs'

let _initialized = false

// Session token storage (since cookies don't work in intercepted fetch)
let _sessionToken: string | null = null

/**
 * Initialize browser prototype mode.
 * This must be called before rendering the React app.
 */
export async function initBrowserPrototype(): Promise<void> {
  if (_initialized) {
    return
  }

  console.log('[Browser Prototype] Initializing...')

  // 1. Initialize PGLite first (this runs the schema SQL)
  await initBrowserPglite()

  // 2. Create browser gateways
  // 3. Create Hono app with browser gateways
  const app = await createBrowserApp()

  // 4. Intercept fetch() to route API requests to in-browser Hono
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const parsedUrl = new URL(url, window.location.origin)

    // Route /api/* and /proxy/* requests to in-browser Hono
    if (parsedUrl.pathname.startsWith('/api/') || parsedUrl.pathname.startsWith('/proxy/')) {
      // Build headers, injecting session token as Authorization header
      // Note: 'cookie' is a forbidden header in browsers, so we use Authorization instead
      const headers = new Headers(init?.headers)
      if (_sessionToken && !headers.has('authorization')) {
        headers.set('authorization', `Bearer ${_sessionToken}`)
      }

      // Create a proper Request object for Hono
      const request = new Request(parsedUrl.href, {
        method: init?.method || 'GET',
        headers,
        body: init?.body,
        credentials: init?.credentials,
      })

      try {
        const response = await app.fetch(request, {
          // Provide minimal env bindings for the Hono app
          // Most are not needed since we're using fake gateways
        } as any)

        // Capture session token from response headers
        // authFake sets both 'Set-Cookie' and 'set-auth-token'
        const authToken = response.headers.get('set-auth-token')
        if (authToken) {
          _sessionToken = authToken
        }

        // Handle sign-out (clear token when Set-Cookie has Max-Age=0)
        const setCookie = response.headers.get('set-cookie')
        if (setCookie?.includes('Max-Age=0')) {
          _sessionToken = null
        }

        return response
      } catch (error) {
        console.error('[Browser Prototype] Error handling request:', parsedUrl.pathname, error)
        throw error
      }
    }

    // Pass through all other requests
    return originalFetch(input, init)
  }

  // 5. Auto-login as admin in prototype mode
  // Query for an existing admin user from the database
  const pglite = getBrowserPglite()

  try {
    // Find the first admin user
    const adminResult = await pglite.query<{ id: string; name: string; email: string; role: 'user' | 'admin' }>(
      `SELECT id, name, email, role FROM users WHERE role = 'admin' LIMIT 1`
    )
    if (!adminResult.rows[0]) {
      throw new Error('admin user not found')
    }
    const adminUser = adminResult.rows[0]
    authFake.injectPrototypeAdmin({
      id: adminUser.id,
      name: adminUser.name || 'Admin',
      email: adminUser.email,
      role: adminUser.role,
    })
    _sessionToken = PROTOTYPE_ADMIN_TOKEN
    tokenStorage.save(PROTOTYPE_ADMIN_TOKEN)
    console.log('[Browser Prototype] Ready! Auto-logged in as admin.')
  } catch {
    console.log('[Browser Prototype] Skip to auto-logged')
  }

  _initialized = true
}
