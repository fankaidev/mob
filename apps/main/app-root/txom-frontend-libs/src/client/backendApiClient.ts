import { inIframe } from "../utils/inIframe"

// ============ HTTP Errors ============
export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    public isBusiness: boolean
  ) {
    super(body || `HTTP ${status}`)
    this.name = 'HttpError'
  }

  get isUnauthorized() { return this.status === 401 }
  get isForbidden() { return this.status === 403 }
  get isNotFound() { return this.status === 404 }
}

export class AuthRequiredError extends Error {
  constructor(message = 'Authentication required') {
    super(message)
    this.name = 'AuthRequiredError'
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Access denied') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class FormError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormError'
  }
}

// ============ Token Storage ============
const TOKEN_KEY = 'paraflow_auth_token'


export const tokenStorage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  save: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  remove: () => localStorage.removeItem(TOKEN_KEY),
}

function tryExtractBusinessError(text: string): string | null {
  try {
    const o = JSON.parse(text)
    if (o && typeof o === 'object' && typeof o.message === 'string') {
      return o.message
    }
    return null
  } catch {
    return null
  }
}

function createAuthFetch(): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    if (inIframe) {
      const token = tokenStorage.get()
      if (token) {
        headers.set('Authorization', `Bearer ${token}`)
      }
    }

    const response = await fetch(input, {
      ...init,
      credentials: inIframe ? 'omit' : 'include',
      headers,
    })

    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthRequiredError()
      }
      if (response.status === 403) {
        throw new ForbiddenError()
      }
      const text = await response.text()
      const businessText = tryExtractBusinessError(text)

      if (businessText) {
        throw new HttpError(response.status, businessText, true)          
      }
      throw new HttpError(response.status, text, false)
    }

    return response
  }
}

// ============ Hono RPC Clients ============

/**
 * Shared auth fetch for Hono RPC clients.
 *
 * Each Store creates its own API client using this fetch:
 * ```ts
 * import { hc } from 'hono/client'
 * import type { MyStoreApi } from '@backend/api/MyStore'
 * import { apiFetch } from '../client/backendApiClient'
 *
 * const api = hc<MyStoreApi>('/api/MyStore', { fetch: apiFetch })
 * ```
 *
 * Error handling is built into the fetch layer - errors are thrown automatically:
 * - 401 → AuthRequiredError
 * - 403 → ForbiddenError
 * - Other errors → HttpError
 */
export const apiFetch = createAuthFetch()

