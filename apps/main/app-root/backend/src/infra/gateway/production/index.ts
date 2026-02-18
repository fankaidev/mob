/**
 * Production Gateway Implementations
 *
 * Exports the production implementations of all gateway interfaces.
 */
import type { Gateways } from '../index'
import { createDbClient } from './db'
import { fetchAuthService } from './auth'
import { ai } from './ai'
import { r2 } from './r2'

export const productionGateways: Gateways = {
  db: { createDbClient },
  auth: { fetchAuthService },
  ai: { createClient: ai },
  r2: { createClient: r2 },
}

// Re-export types and utilities from individual modules
export type { DbClient, DbTransaction } from './db'
export { createDbFromEnv, schema } from './db'
export type { ChatCompletionRequest, ChatCompletionResponse, ImageGenerationRequest, ImageGenerationResponse } from './ai'
export { AIError } from './ai'
export type { R2UploadResult } from './r2'
export { R2Error } from './r2'
