import React, { useState, useEffect } from 'react'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (baseUrl: string, apiKey: string, model: string, provider: string) => void
  initialBaseUrl: string
  initialApiKey: string
  initialModel: string
  initialProvider: string
}

export function SettingsModal({ isOpen, onClose, onSave, initialBaseUrl, initialApiKey, initialModel, initialProvider }: SettingsModalProps) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl)
  const [apiKey, setApiKey] = useState(initialApiKey)
  const [model, setModel] = useState(initialModel)
  const [provider, setProvider] = useState(initialProvider)
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning', message: string } | null>(null)

  // Update local state when props change
  useEffect(() => {
    setBaseUrl(initialBaseUrl)
    setApiKey(initialApiKey)
    setModel(initialModel)
    setProvider(initialProvider)
  }, [initialBaseUrl, initialApiKey, initialModel, initialProvider])

  const handleSave = () => {
    if (!apiKey.trim()) {
      setStatus({ type: 'error', message: 'API Key is required' })
      return
    }
    if (!baseUrl.trim()) {
      setStatus({ type: 'error', message: 'Base URL is required' })
      return
    }
    if (!model.trim()) {
      setStatus({ type: 'error', message: 'Model is required' })
      return
    }
    if (!provider.trim()) {
      setStatus({ type: 'error', message: 'Provider is required' })
      return
    }

    onSave(baseUrl, apiKey, model, provider)
    setStatus({ type: 'success', message: 'Settings saved successfully!' })

    setTimeout(() => {
      onClose()
      setStatus(null)
    }, 1000)
  }

  if (!isOpen) return null

  return (
    <div className="modal show" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {status && (
          <div className={`settings-status ${status.type}`}>
            {status.message}
          </div>
        )}

        <div className="form-group">
          <label htmlFor="api-base-url">API Base URL</label>
          <input
            type="text"
            id="api-base-url"
            placeholder="https://api.anthropic.com"
            value={baseUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBaseUrl(e.target.value)}
          />
          <small>Anthropic API endpoint</small>
        </div>

        <div className="form-group">
          <label htmlFor="api-key">API Key</label>
          <input
            type="password"
            id="api-key"
            placeholder="sk-ant-api03-..."
            value={apiKey}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
          />
          <small>Your Anthropic API key</small>
        </div>

        <div className="form-group">
          <label htmlFor="api-model">Model</label>
          <input
            type="text"
            id="api-model"
            placeholder="claude-sonnet-4-5-20250929-id"
            value={model}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setModel(e.target.value)}
          />
          <small>Model name (e.g. claude-sonnet-4-5-20250929-id)</small>
        </div>

        <div className="form-group">
          <label htmlFor="api-provider">Provider</label>
          <select
            id="api-provider"
            value={provider}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setProvider(e.target.value)}
          >
            <option value="">Select a provider</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
          </select>
          <small>AI provider</small>
        </div>

        <button onClick={handleSave} style={{ width: '100%' }}>Save Settings</button>
      </div>
    </div>
  )
}
