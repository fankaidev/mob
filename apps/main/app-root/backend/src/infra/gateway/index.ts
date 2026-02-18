/**
 * Gateway Registry
 *
 * Defines interfaces for all external service gateways.
 * In production, uses real implementations.
 * In tests, can be replaced with mocks via Hono context injection.
 *
 * Note: Error classes (AIError, R2Error) are NOT part of gateways.
 * They are imported directly from their modules since they don't need to be swapped.
 */
import type { Bindings } from '../../types/env'
import type { DbClient } from './production/db'
import type { ChatCompletionRequest, ChatCompletionResponse, ImageGenerationRequest, ImageGenerationResponse } from './production/ai'
import type { R2UploadResult } from './production/r2'

// ============================================================================
// Gateway Interfaces
// ============================================================================

export interface AiClient {
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse>
}

export interface R2Client {
  upload(path: string, data: ArrayBuffer | Blob | ReadableStream<Uint8Array>, extension: string): Promise<R2UploadResult>
  download(resourceUrl: string): Promise<ArrayBuffer>
  delete(resourceId: string): Promise<void>
}

export interface Gateways {
  db: {
    createDbClient(env: Bindings): Promise<{ db: DbClient; cleanup: () => Promise<void> }>
  }
  auth: {
    fetchAuthService(
      env: Bindings,
      path: string,
      options?: {
        method?: string
        headers?: HeadersInit
        body?: BodyInit | null
      }
    ): Promise<Response>
  }
  ai: {
    createClient(env: Bindings, fetchWithLog: typeof fetch): AiClient
  }
  r2: {
    createClient(env: Bindings, fetchWithLog: typeof fetch): R2Client
  }
}

// ============================================================================
// Re-export from production for backward compatibility
// ============================================================================

export { productionGateways } from './production'
export type { DbClient, DbTransaction } from './production/db'
export { createDbFromEnv, schema } from './production/db'
export type { ChatCompletionRequest, ChatCompletionResponse, ImageGenerationRequest, ImageGenerationResponse } from './production/ai'
export { AIError } from './production/ai'
export type { R2UploadResult } from './production/r2'
export { R2Error } from './production/r2'
