/**
 * Auth Client Fake - Pure TypeScript implementation
 *
 * Fakes the third-party authentication service (better-auth) client.
 * Uses dynamicUsers for user management and session simulation.
 * Users are auto-registered on sign-in if they don't exist.
 */
import type { Bindings } from '../../../types/env'

// Prototype admin - auto-injected in FAST_PROTOTYPE_MODE
export const PROTOTYPE_ADMIN_TOKEN = 'prototype-admin-token'

// Global testId storage for fake to access
let currentTestId: string = 'default-test'

// Counter for unique session tokens (Date.now() returns 0 during module init in Cloudflare Workers)
let sessionCounter = 0

// Dynamic users storage: testId -> Map<userId, user>
// Stores users created during sign-in (for users not in TEST_USERS)
type DynamicUser = { id: string; name: string; email: string; role: 'user' | 'admin' }
const dynamicUsersStores = new Map<string, Map<string, DynamicUser>>()

/**
 * Session store management (encapsulated in IIFE)
 */
const { getOrCreateSessionStore, cleanupSessionStore } = (() => {
  // Session storage: testId -> Map<token, userId>
  const sessionStores = new Map<string, Map<string, string>>()

  return {
    getOrCreateSessionStore: (testId: string): Map<string, string> => {
      let sessions = sessionStores.get(testId)
      if (!sessions) {
        sessions = new Map()
        sessionStores.set(testId, sessions)
      }
      return sessions
    },
    cleanupSessionStore: (testId: string) => {
      sessionStores.delete(testId)
    }
  }
})()

export const authFake = {
  async fetch(
    _env: Bindings,
    rawPath: string,
    options: {
      method?: string
      headers?: HeadersInit
      body?: BodyInit | null
    } = {}
  ): Promise<Response> {
    const method = options.method || 'GET'
    const headers = new Headers(options.headers)

    // Strip query string for path matching
    const path = rawPath.split('?')[0]

    let body: Record<string, string> | null = null
    if (options.body) {
      if (typeof options.body === 'string') {
        body = JSON.parse(options.body)
      } else if (options.body instanceof FormData) {
        body = Object.fromEntries((options.body as unknown as Iterable<[string, string]>))
      } else if (options.body instanceof ReadableStream || options.body instanceof Blob) {
        const text = await new Response(options.body).text()
        body = text ? JSON.parse(text) : null
      } else {
        try {
          const text = await new Response(options.body as BodyInit).text()
          body = text ? JSON.parse(text) : null
        } catch (e) {
          // Ignore parse errors
        }
      }
    }

    const cookie = headers.get('cookie')
    const authorization = headers.get('authorization')
    const token = cookie?.match(/session_token=([^;]+)/)?.[1] || authorization?.replace('Bearer ', '')

    // Get session store for this test (auto-creates with admin session)
    const sessions = getOrCreateSessionStore(currentTestId)

    // Get dynamic users store for this test
    let dynamicUsers = dynamicUsersStores.get(currentTestId)
    if (!dynamicUsers) {
      dynamicUsers = new Map()
      dynamicUsersStores.set(currentTestId, dynamicUsers)
    }

    try {
      if (method === 'POST' && path === '/sign-up/email') {
        if (!body) return new Response(JSON.stringify({ error: { message: 'Missing request body' } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        const { email, name } = body
        // Check if user already exists in dynamicUsers
        let existingUser: DynamicUser | undefined
        for (const du of dynamicUsers.values()) {
          if (du.email === email) {
            existingUser = du
            break
          }
        }
        if (existingUser) {
          return new Response(JSON.stringify({ error: { message: 'User already exists' } }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const newUser = {
          id: crypto.randomUUID(),
          name,
          email,
          emailVerified: false,
          image: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          role: 'user' as const,
        }

        const sessionToken = `session-${++sessionCounter}-${Math.random().toString(36).substring(7)}`
        sessions.set(sessionToken, newUser.id)

        return new Response(JSON.stringify({ user: newUser, session: { token: sessionToken } }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': `session_token=${sessionToken}; HttpOnly; Path=/; Secure; SameSite=Lax; Max-Age=604800`,
            'set-auth-token': sessionToken,
          },
        })
      }

      if (method === 'POST' && path === '/sign-in/email') {
        if (!body) return new Response(JSON.stringify({ error: { message: 'Missing request body' } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        const { email, password, name } = body
        let dynamicUser: DynamicUser | undefined

        // Check dynamic users
        for (const du of dynamicUsers.values()) {
          if (du.email === email) {
            dynamicUser = du
            break
          }
        }

        // Auto-register if user doesn't exist
        if (!dynamicUser) {
          const newUserId = crypto.randomUUID()
          dynamicUser = {
            id: newUserId,
            name: name || email.split('@')[0],
            email,
            role: 'user',
          }
          dynamicUsers.set(newUserId, dynamicUser)
        }

        const sessionToken = `session-${++sessionCounter}-${Math.random().toString(36).substring(7)}`
        sessions.set(sessionToken, dynamicUser.id)

        return new Response(JSON.stringify({
          redirect: false,
          user: {
            id: dynamicUser.id,
            name: dynamicUser.name,
            email: dynamicUser.email,
            emailVerified: true,
            image: null,
            createdAt: '2025-12-27T08:49:03.372Z',
            updatedAt: '2025-12-27T08:59:12.899Z',
            role: dynamicUser.role,
          },
          session: {
            token: sessionToken,
            expiresAt: '2099-01-03T08:59:12.910Z',
            createdAt: '2025-12-27T08:59:12.910Z',
            updatedAt: '2025-12-27T08:59:12.910Z',
          },
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': `session_token=${sessionToken}; HttpOnly; Path=/; Secure; SameSite=Lax; Max-Age=604800`,
            'set-auth-token': sessionToken,
          },
        })
      }

      if (method === 'POST' && path === '/sign-out') {
        if (token) {
          sessions.delete(token)
        }
        return new Response(JSON.stringify({ message: 'Signed out successfully' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': 'session_token=; HttpOnly; Path=/; Secure; SameSite=Lax; Max-Age=0',
          },
        })
      }

      if (method === 'GET' && path === '/get-session') {
        if (!token) {
          return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const userId = sessions.get(token)
        if (!userId) {
          return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Look up user in dynamic users
        const dynamicUser = dynamicUsers.get(userId)

        if (!dynamicUser) {
          return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return new Response(JSON.stringify({
          session: {
            expiresAt: '2099-01-03T08:59:12.910Z',
            token: token,
            createdAt: '2025-12-27T08:59:12.910Z',
            updatedAt: '2025-12-27T08:59:12.910Z',
            ipAddress: '',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            userId: dynamicUser.id,
            id: 'MWQeknPnGdOE3645DN9wSo3EADel4f12',
          },
          user: {
            name: dynamicUser.name,
            email: dynamicUser.email,
            emailVerified: true,
            image: null,
            createdAt: '2025-12-27T08:49:03.372Z',
            updatedAt: '2025-12-27T08:59:12.899Z',
            id: dynamicUser.id,
            role: dynamicUser.role,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (method === 'POST' && path === '/callback') {
        const callbackToken = body?.token || token
        if (!callbackToken) {
          return new Response(JSON.stringify({ error: { message: 'Invalid token' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const userId = sessions.get(callbackToken)
        if (!userId) {
          return new Response(JSON.stringify({ error: { message: 'Invalid token' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const dynamicUser = dynamicUsers.get(userId)
        if (!dynamicUser) {
          return new Response(JSON.stringify({ error: { message: 'Invalid token' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return new Response(JSON.stringify({
          user: {
            id: dynamicUser.id,
            name: dynamicUser.name,
            email: dynamicUser.email,
            emailVerified: true,
            image: null,
            createdAt: '2025-12-27T08:49:03.372Z',
            updatedAt: '2025-12-27T08:59:12.899Z',
            role: dynamicUser.role,
          },
          session: {
            token: callbackToken,
            expiresAt: '2099-01-03T08:59:12.910Z',
            createdAt: '2025-12-27T08:59:12.910Z',
            updatedAt: '2025-12-27T08:59:12.910Z',
          },
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': `session_token=${callbackToken}; HttpOnly; Path=/; Secure; SameSite=Lax; Max-Age=604800`,
            'set-auth-token': callbackToken,
          },
        })
      }

      if (method === 'POST' && path === '/email-otp/verify-email') {
        return new Response(JSON.stringify({ status: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (method === 'POST' && path === '/email-otp/send-verification-otp') {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Support both /forget-password (old) and /request-password-reset (better-auth v1.4+)
      if (method === 'POST' && (path === '/forget-password' || path === '/request-password-reset')) {
        // better-auth expects this exact format for successful password reset request
        return new Response(JSON.stringify({ status: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (method === 'POST' && path === '/reset-password') {
        // better-auth expects this exact format for successful password reset
        return new Response(JSON.stringify({ status: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (method === 'GET' && path.startsWith('/sign-in/social')) {
        const url = new URL(path, 'http://localhost:3000')
        const callbackURL = url.searchParams.get('callbackURL') || 'http://localhost:3000/auth/callback'
        return Response.redirect(`${callbackURL}?code=fake-oauth-code`)
      }

      return new Response(JSON.stringify({ error: { message: 'Not found' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      const status = error instanceof Error && error.message.includes('Invalid') ? 401 : 400
      return new Response(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'Request failed' } }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  },

  reset(testId: string) {
    currentTestId = testId
    cleanupSessionStore(testId)
    dynamicUsersStores.delete(testId)
  },

  /**
   * Inject prototype admin session.
   * Call this in FAST_PROTOTYPE_MODE to auto-login as admin.
   */
  injectPrototypeAdmin(user: { id: string; name: string; email: string; role: 'user' | 'admin' }) {
    const sessions = getOrCreateSessionStore(currentTestId)
    sessions.set(PROTOTYPE_ADMIN_TOKEN, user.id)

    let dynamicUsers = dynamicUsersStores.get(currentTestId)
    if (!dynamicUsers) {
      dynamicUsers = new Map()
      dynamicUsersStores.set(currentTestId, dynamicUsers)
    }
    dynamicUsers.set(user.id, {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    })
  },
}