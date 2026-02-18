import { getModel, getModels, type Model } from '../pi-ai/src/index'

const STORAGE_KEY_PREFIX = 'pi-agent-'

export interface AgentConfig {
  apiKey: string
  apiUrl: string
  modelId: string
  provider: string
}

const DEFAULT_CONFIG: AgentConfig = {
  apiKey: '',
  apiUrl: '',
  modelId: 'claude-opus-4-20250918',
  provider: 'anthropic',
}

export function loadConfig(): AgentConfig {
  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}config`)
    if (stored) {
      const parsed = JSON.parse(stored)
      return { ...DEFAULT_CONFIG, ...parsed }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG }
}

export function saveConfig(config: AgentConfig): void {
  localStorage.setItem(`${STORAGE_KEY_PREFIX}config`, JSON.stringify(config))
}

export function getConfiguredModel(config: AgentConfig): Model<any> {
  try {
    const model = getModel(config.provider as any, config.modelId as any)
    if (config.apiUrl) {
      return { ...model, baseUrl: config.apiUrl }
    }
    return model
  } catch {
    // Fallback: try to find the model in any provider
    return getModel('anthropic', 'claude-opus-4-20250918' as any)
  }
}

export function getAvailableModels(): Array<{ provider: string; id: string; name: string }> {
  const result: Array<{ provider: string; id: string; name: string }> = []
  const providers = ['anthropic', 'openai', 'google'] as const
  for (const provider of providers) {
    try {
      const models = getModels(provider as any)
      for (const model of models) {
        result.push({ provider: model.provider, id: model.id, name: model.name })
      }
    } catch { /* provider not available */ }
  }
  return result
}
