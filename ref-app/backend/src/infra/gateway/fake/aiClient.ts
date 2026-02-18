/**
 * AI Client Fake - Pure TypeScript implementation
 *
 * @example
 * aiFake.responses.chat.choices[0].message.content = 'Custom response'
 */
import type { ChatCompletion } from 'openai/resources/chat/completions'
import type { ImagesResponse } from 'openai/resources/images'

type ChatCompletionResponse = ChatCompletion
type ImageGenerationResponse = ImagesResponse

const defaultChatResponse: ChatCompletionResponse = {
  id: 'fake-chat-id',
  object: 'chat.completion',
  created: 1700000000,
  model: 'gpt-4',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Fake AI response', refusal: null }, finish_reason: 'stop', logprobs: null }],
}

// Use b64_json instead of url to avoid HTTP fetch in tests
// This is a 1x1 red PNG encoded as base64
const FAKE_IMAGE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

const defaultImageResponse: ImageGenerationResponse = {
  created: 1700000000,
  data: [{ b64_json: FAKE_IMAGE_B64 }],
}

export const aiFake = {
  responses: {
    chat: { ...defaultChatResponse } as ChatCompletionResponse,
    image: { ...defaultImageResponse } as ImageGenerationResponse,
  },

  async chat(_request: unknown) {
    return aiFake.responses.chat
  },

  async generateImage(_request: unknown) {
    return aiFake.responses.image
  },

  reset() {
    aiFake.responses.chat = { ...defaultChatResponse }
    aiFake.responses.image = { ...defaultImageResponse }
  },
}
