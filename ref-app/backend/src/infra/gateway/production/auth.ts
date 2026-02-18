import type { Bindings } from '../../../types/env'

/**
 * Fetch from auth service using Service Binding (production) or direct fetch (local dev)
 *
 * @param env - Environment with auth config
 * @param path - Request path (e.g., "/get-session", "/sign-in/email")
 * @param options - Request options (method, headers, body)
 */
export async function fetchAuthService(
  env: Bindings,
  path: string,
  options: {
    method?: string
    headers?: HeadersInit
    body?: BodyInit | null
  } = {}
): Promise<Response> {
  const appId = env.PARAFLOW_APP_ID
  const authApiUrl = env.PARAFLOW_AUTH_API_URL
  const authService = env.PARAFLOW_SERVICE_AUTH

  if (!appId || !authApiUrl) {
    throw new Error('Authentication feature is not enabled.')
  }

  // Build headers with app ID
  const headers = new Headers(options.headers)
  headers.set('x-app-id', appId)
  const targetUrl = `${authApiUrl}${path}`

  if (authService) {
    const request = new Request(targetUrl, {
      method: options.method || 'GET',
      headers,
      body: options.body,
    })
    return authService.fetch(request)
  } else {
    return fetch(targetUrl, {
      method: options.method || 'GET',
      headers,
      body: options.body,
    })
  }
}
