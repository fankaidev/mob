/**
 * AI Gateway Client
 *
 * A simple client for interacting with AI Gateway (OpenAI-compatible API).
 * Supports chat completions and image generation.
 *
 * Attention: Agents should NOT modify this file's API structure unless explicitly required.
 */

import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletion,
} from 'openai/resources/chat/completions'
import type { ImageGenerateParams, ImagesResponse } from 'openai/resources/images'

export type ChatCompletionRequest = Omit<ChatCompletionCreateParamsNonStreaming, 'model'>
export type ChatCompletionResponse = ChatCompletion
export type ImageGenerationRequest = Pick<ImageGenerateParams, 'prompt' | 'size'>
export type ImageGenerationResponse = ImagesResponse

export class AIError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AIError'
  }
}

function initHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Get AI client
 * Reads environment variables and handles Service Binding internally.
 *
 * @param env - Environment bindings with AI Gateway config
 * @param fetchWithLog - Fallback fetch with logging (used if Service Binding not available)
 */
export function ai(env: import('../../../types/env').Bindings, fetchWithLog: typeof fetch) {
  const baseUrl = env.PARAFLOW_AI_GATEWAY_OPENAI_BASE_URL
  const token = env.PARAFLOW_AI_GATEWAY_TOKEN

  if (!baseUrl || !token) {
    throw new AIError('AI feature is not enabled.')
  }

  // Use Service Binding for zero-latency internal calls (production)
  // Fallback to fetchWithLog for HTTP calls with logging (dev/test)
  const fetchFn = env.PARAFLOW_SERVICE_AI_GATEWAY
    ? (env.PARAFLOW_SERVICE_AI_GATEWAY.fetch.bind(env.PARAFLOW_SERVICE_AI_GATEWAY) as unknown as typeof fetch)
    : fetchWithLog

  return {
    /**
     * Send a chat completion request
     * @param request - Chat completion request parameters
     * @returns Chat completion response
     */
    async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
      const response = await fetchFn(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: initHeaders(token),
        body: JSON.stringify(request),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new AIError(`Chat completion failed: ${JSON.stringify(data)}`)
      }

      return data as ChatCompletionResponse
    },

    /**
     * Generate images from a prompt
     * @param request - Image generation request parameters
     * @returns Image generation response
     */
    async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
      const response = await fetchFn(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: initHeaders(token),
        body: JSON.stringify(request),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new AIError(`Image generation failed: ${JSON.stringify(data)}`)
      }

      return data as ImageGenerationResponse
    },
  }
}
