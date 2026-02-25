# API Support

## Current Implementation

Currently, the codebase uses **Anthropic Messages API format** for all LLM providers.

### Supported Providers

All providers must use Anthropic Messages API-compatible endpoints:

- **Anthropic**: Native support via `https://api.anthropic.com/v1`
- **OpenRouter**: Use the base endpoint `https://openrouter.ai/api/v1` (not `/chat/completions`)
- **Other providers**: Must support Anthropic Messages API format

### Automatic URL Conversion

The system automatically converts OpenAI-style endpoints to Anthropic format:

```
https://openrouter.ai/api/v1/chat/completions → https://openrouter.ai/api/v1
```

This allows using OpenRouter and other LiteLLM-based services that support both API formats.

## Configuration

In your LLM config:

```json
{
  "name": "OpenRouter Kimi",
  "provider": "openai",
  "base_url": "https://openrouter.ai/api/v1/chat/completions",
  "model": "moonshot/kimi-k2.5",
  "api_key": "your-key"
}
```

The `base_url` will be automatically converted to `https://openrouter.ai/api/v1` and the Anthropic SDK will append `/messages`.

## Future Improvements

### Native OpenAI API Support

To fully support OpenAI Chat Completions API:

1. **Create OpenAI Provider** (`src/lib/pi-ai/providers/openai.ts`):
   - Implement `streamOpenAI()` function
   - Handle OpenAI streaming format
   - Convert tool calls format

2. **Update buildModel** (`src/durable-objects/ChatSession.ts`):
   ```typescript
   private buildModel(baseUrl: string, modelId: string, provider: string): Model<any> {
     const api = provider === 'openai' ? 'openai-completions' : 'anthropic-messages'
     return { ...config, api }
   }
   ```

3. **Update agent-loop** (`src/lib/pi-agent/agent-loop.ts`):
   ```typescript
   const streamFunction = model.api === 'openai-completions'
     ? streamOpenAI
     : streamSimpleAnthropic
   ```

### Benefits of Native Support

- Direct OpenAI API usage without conversion
- Better compatibility with OpenAI-only features
- Reduced latency (no format conversion needed)
- Support for providers that only offer OpenAI format

## Troubleshooting

### "Unexpected non-whitespace character after JSON" Error

This error occurs when:
1. Using OpenAI Chat Completions endpoint with Anthropic API
2. Provider returns malformed JSON in tool calls

**Solution**: Ensure your `base_url` doesn't include `/chat/completions`, or the system will auto-convert it.

### Tool Calls Not Working

If tool calls fail:
1. Check that the provider supports Anthropic Messages API format
2. Verify the base URL is correct (should not end with `/chat/completions`)
3. Check provider documentation for Anthropic compatibility
