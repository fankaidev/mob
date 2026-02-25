# API Support

## Current Implementation

The codebase now supports both **OpenAI Chat Completions API** and **Anthropic Messages API** formats.

### Supported Providers

#### OpenAI Chat Completions API (provider: openai, groq, together, xai, deepseek, perplexity)
- **OpenAI**: `https://api.openai.com/v1`
- **Groq**: `https://api.groq.com/openai/v1`
- **Together AI**: `https://api.together.xyz/v1`
- **xAI**: `https://api.x.ai/v1`
- **DeepSeek**: `https://api.deepseek.com/v1`
- **Perplexity**: `https://api.perplexity.ai`
- **OpenRouter**: `https://openrouter.ai/api/v1` (auto-detects format)

#### Anthropic Messages API (provider: anthropic, or others)
- **Anthropic**: `https://api.anthropic.com/v1`
- **AWS Bedrock**: Via Anthropic Messages format
- **Other LiteLLM services**: Any service that implements Anthropic Messages API

### Automatic API Selection

The system automatically selects the correct API format based on the `provider` field in your configuration:
- `openai`, `groq`, `together`, `xai`, `deepseek`, `perplexity` → OpenAI Chat Completions API
- `anthropic` or any other value → Anthropic Messages API

## Configuration

### OpenAI-Compatible Provider

```json
{
  "name": "OpenRouter Kimi",
  "provider": "openai",
  "base_url": "https://openrouter.ai/api/v1",
  "model": "moonshot/kimi-k2.5",
  "api_key": "your-key"
}
```

The OpenAI SDK will automatically append `/chat/completions` to the base URL.

### Anthropic-Compatible Provider

```json
{
  "name": "Claude",
  "provider": "anthropic",
  "base_url": "https://api.anthropic.com/v1",
  "model": "claude-opus-4-20250514",
  "api_key": "your-key"
}
```

The Anthropic SDK will automatically append `/messages` to the base URL.

## Implementation Details

### Provider Files

- `src/lib/pi-ai/providers/openai-completions.ts` - OpenAI Chat Completions streaming implementation
- `src/lib/pi-ai/providers/anthropic.ts` - Anthropic Messages streaming implementation
- `src/lib/pi-agent/agent-loop.ts` - Automatically selects appropriate stream function based on `model.api`

### API Selection Logic

In `src/durable-objects/ChatSession.ts`:

```typescript
private buildModel(baseUrl: string, modelId: string, provider: string): Model<any> {
  const providerLower = provider.toLowerCase()

  const useOpenAIAPI = [
    'openai', 'groq', 'together', 'xai', 'deepseek', 'perplexity'
  ].includes(providerLower)

  return {
    api: useOpenAIAPI ? 'openai-completions' : 'anthropic-messages',
    // ... other config
  }
}
```

### Stream Function Selection

In `src/lib/pi-agent/agent-loop.ts`:

```typescript
const streamFunction = streamFn || (
  config.model.api === 'openai-completions'
    ? streamSimpleOpenAICompletions
    : streamSimpleAnthropic
)
```

## Troubleshooting

### "Unexpected non-whitespace character after JSON" Error

This error may occur when:
1. Provider returns malformed JSON in tool calls
2. API format mismatch between configuration and actual endpoint

**Solution**:
1. Ensure your `provider` field matches the actual API format
2. For OpenAI-compatible providers, use: `provider: "openai"`
3. For Anthropic-compatible providers, use: `provider: "anthropic"`

### Tool Calls Not Working

If tool calls fail:
1. Verify the `provider` field is set correctly
2. Check that the base URL matches the provider's API endpoint
3. Ensure the model supports tool calling
4. Check API key permissions
