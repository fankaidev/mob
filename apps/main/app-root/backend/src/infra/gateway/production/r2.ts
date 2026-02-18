/**
 * R2 Storage Client
 *
 * A simple client for interacting with Paraflow R2 storage service.
 * Supports PUT, GET, DELETE operations.
 *
 * Attention: Agents should NOT modify this file's API structure unless explicitly required.
 *
 * Usage:
 *   import { r2 } from '../infra/gateway/r2'
 *   await r2(baseUrl, token).upload('public', data, 'png')
 */

import mime from 'mime'

export interface R2UploadResult {
  resourceUrl: string
  resourceId: string
}

export class R2Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'R2Error'
  }
}

function initHeaders(token: string, contentType?: string): HeadersInit {
  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
  }
  if (contentType) {
    headers['Content-Type'] = contentType
  }
  return headers
}

/**
 * Generate a unique resource ID using timestamp + random hex
 */
function generateResourceId(): string {
  const timestamp = Date.now().toString(36)
  const randomPart = crypto.randomUUID().replace(/-/g, '')
  return `${timestamp}_${randomPart}`
}

/**
 * Get R2 client
 * Reads environment variables and handles Service Binding internally.
 *
 * @param env - Environment bindings with R2 config
 * @param fetchWithLog - Fallback fetch with logging (used if Service Binding not available)
 */
export function r2(env: import('../../../types/env').Bindings, fetchWithLog: typeof fetch) {
  const baseUrl = env.PARAFLOW_R2_PROXY_DOMAIN
  const token = env.PARAFLOW_R2_TOKEN

  if (!baseUrl || !token) {
    throw new R2Error('R2 Storage feature is not enabled.')
  }

  // Use Service Binding for zero-latency internal calls (production)
  // Fallback to fetchWithLog for HTTP calls with logging (dev/test)
  const fetchFn = env.PARAFLOW_SERVICE_R2
    ? (env.PARAFLOW_SERVICE_R2.fetch.bind(env.PARAFLOW_SERVICE_R2) as unknown as typeof fetch)
    : fetchWithLog

  return {
    /**
     * Upload a file to R2 storage
     * @param path - Directory path (e.g., "public", "images/avatars")
     * @param data - File content
     * @param extension - File extension (e.g., "png", "jpg", "pdf")
     * @returns resourceUrl and resourceId
     */
    async upload(
      path: string,
      data: ArrayBuffer | Blob | ReadableStream<Uint8Array>,
      extension: string
    ): Promise<R2UploadResult> {
      const resourceId = generateResourceId()
      const fileName = `${resourceId}.${extension}`
      const fullPath = path ? `${path}/${fileName}` : fileName
      const contentType = mime.getType(extension)
      if (contentType == null) {
        throw new R2Error("can't transfer content type")
      }

      const response = await fetchFn(`${baseUrl}/${fullPath}`, {
        method: 'PUT',
        headers: initHeaders(token, contentType),
        body: data,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new R2Error(errorText)
      }

      const result = (await response.json()) as { resourceUrl: string }
      return {
        resourceUrl: result.resourceUrl,
        resourceId,
      }
    },

    /**
     * Download a file from R2 storage
     * @param resourceUrl - The public URL returned from upload
     */
    async download(resourceUrl: string): Promise<ArrayBuffer> {
      const response = await fetch(resourceUrl)

      if (!response.ok) {
        const errorText = await response.text()
        throw new R2Error(errorText)
      }

      return response.arrayBuffer()
    },

    /**
     * Delete a file from R2 storage
     * @param resourceId - The resourceId returned from upload
     */
    async delete(resourceId: string): Promise<void> {
      const response = await fetchFn(`${baseUrl}/${resourceId}`, {
        method: 'DELETE',
        headers: initHeaders(token),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new R2Error(errorText)
      }
    },
  }
}
