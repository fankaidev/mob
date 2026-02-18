import React, { useState, useEffect } from 'react'

// Types
interface LLMConfig {
  name: string
  provider: string
  base_url: string
  api_key?: string
  model: string
  created_at?: number
  updated_at?: number
}

interface SlackApp {
  id?: number
  app_id: string
  team_id?: string
  app_name: string
  bot_token?: string
  signing_secret?: string
  bot_user_id?: string
  llm_config_name: string
  system_prompt?: string
  created_at?: number
  updated_at?: number
}

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectConfig: (config: LLMConfig | null) => void
  selectedConfigName: string | null
}

type TabType = 'select' | 'llm-configs' | 'slack-apps'

export function SettingsModal({ isOpen, onClose, onSelectConfig, selectedConfigName }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('select')
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  // LLM Configs state
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[]>([])
  const [editingLlmConfig, setEditingLlmConfig] = useState<LLMConfig | null>(null)
  const [isNewLlmConfig, setIsNewLlmConfig] = useState(false)

  // Slack Apps state
  const [slackApps, setSlackApps] = useState<SlackApp[]>([])
  const [editingSlackApp, setEditingSlackApp] = useState<SlackApp | null>(null)
  const [isNewSlackApp, setIsNewSlackApp] = useState(false)

  // Load data when modal opens
  useEffect(() => {
    if (isOpen) {
      loadLlmConfigs()
      loadSlackApps()
    }
  }, [isOpen])

  // Clear status after 3 seconds
  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [status])

  const loadLlmConfigs = async () => {
    try {
      const response = await fetch('/api/admin/llm-configs')
      if (response.ok) {
        const data = await response.json() as { configs: LLMConfig[] }
        setLlmConfigs(data.configs)
      }
    } catch (error) {
      console.error('Failed to load LLM configs:', error)
    }
  }

  const loadSlackApps = async () => {
    try {
      const response = await fetch('/api/admin/slack-apps')
      if (response.ok) {
        const data = await response.json() as { apps: SlackApp[] }
        setSlackApps(data.apps)
      }
    } catch (error) {
      console.error('Failed to load Slack apps:', error)
    }
  }

  // LLM Config handlers
  const handleSaveLlmConfig = async () => {
    if (!editingLlmConfig) return

    const { name, provider, base_url, api_key, model } = editingLlmConfig
    if (!name || !provider || !base_url || !model) {
      setStatus({ type: 'error', message: 'Please fill in all required fields' })
      return
    }

    if (isNewLlmConfig && !api_key) {
      setStatus({ type: 'error', message: 'API key is required for new config' })
      return
    }

    try {
      const url = isNewLlmConfig
        ? '/api/admin/llm-configs'
        : `/api/admin/llm-configs/${name}`
      const method = isNewLlmConfig ? 'POST' : 'PUT'

      const body: any = { provider, base_url, model }
      if (isNewLlmConfig) body.name = name
      if (api_key) body.api_key = api_key

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (response.ok) {
        setStatus({ type: 'success', message: `Config ${isNewLlmConfig ? 'created' : 'updated'} successfully` })
        setEditingLlmConfig(null)
        setIsNewLlmConfig(false)
        loadLlmConfigs()
      } else {
        const data = await response.json() as { error: string }
        setStatus({ type: 'error', message: data.error || 'Failed to save config' })
      }
    } catch (error) {
      setStatus({ type: 'error', message: 'Failed to save config' })
    }
  }

  const handleDeleteLlmConfig = async (name: string) => {
    if (!confirm(`Delete LLM config "${name}"?`)) return

    try {
      const response = await fetch(`/api/admin/llm-configs/${name}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setStatus({ type: 'success', message: 'Config deleted successfully' })
        loadLlmConfigs()
        if (selectedConfigName === name) {
          onSelectConfig(null)
        }
      } else {
        const data = await response.json() as { error: string }
        setStatus({ type: 'error', message: data.error || 'Failed to delete config' })
      }
    } catch (error) {
      setStatus({ type: 'error', message: 'Failed to delete config' })
    }
  }

  // Slack App handlers
  const handleSaveSlackApp = async () => {
    if (!editingSlackApp) return

    const { app_id, app_name, bot_token, signing_secret, llm_config_name } = editingSlackApp
    if (!app_id || !app_name || !llm_config_name) {
      setStatus({ type: 'error', message: 'Please fill in all required fields' })
      return
    }

    if (isNewSlackApp && (!bot_token || !signing_secret)) {
      setStatus({ type: 'error', message: 'Bot token and signing secret are required for new app' })
      return
    }

    try {
      const url = isNewSlackApp
        ? '/api/admin/slack-apps'
        : `/api/admin/slack-apps/${app_id}`
      const method = isNewSlackApp ? 'POST' : 'PUT'

      const body: any = { app_name, llm_config_name }
      if (isNewSlackApp) {
        body.app_id = app_id
        body.bot_token = bot_token
        body.signing_secret = signing_secret
      } else {
        if (bot_token) body.bot_token = bot_token
        if (signing_secret) body.signing_secret = signing_secret
      }
      if (editingSlackApp.team_id) body.team_id = editingSlackApp.team_id
      if (editingSlackApp.system_prompt !== undefined) body.system_prompt = editingSlackApp.system_prompt

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (response.ok) {
        setStatus({ type: 'success', message: `Slack app ${isNewSlackApp ? 'created' : 'updated'} successfully` })
        setEditingSlackApp(null)
        setIsNewSlackApp(false)
        loadSlackApps()
      } else {
        const data = await response.json() as { error: string }
        setStatus({ type: 'error', message: data.error || 'Failed to save Slack app' })
      }
    } catch (error) {
      setStatus({ type: 'error', message: 'Failed to save Slack app' })
    }
  }

  const handleDeleteSlackApp = async (appId: string) => {
    if (!confirm(`Delete Slack app "${appId}"?`)) return

    try {
      const response = await fetch(`/api/admin/slack-apps/${appId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setStatus({ type: 'success', message: 'Slack app deleted successfully' })
        loadSlackApps()
      } else {
        const data = await response.json() as { error: string }
        setStatus({ type: 'error', message: data.error || 'Failed to delete Slack app' })
      }
    } catch (error) {
      setStatus({ type: 'error', message: 'Failed to delete Slack app' })
    }
  }

  const handleSelectConfig = async (name: string) => {
    try {
      const response = await fetch(`/api/admin/llm-configs/${name}`)
      if (response.ok) {
        const data = await response.json() as { config: LLMConfig }
        onSelectConfig(data.config)
        setStatus({ type: 'success', message: `Selected: ${name}` })
      }
    } catch (error) {
      setStatus({ type: 'error', message: 'Failed to load config' })
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal show" onClick={onClose}>
      <div className="modal-content settings-modal-large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {status && (
          <div className={`settings-status ${status.type}`}>
            {status.message}
          </div>
        )}

        {/* Tabs */}
        <div className="settings-tabs">
          <button
            className={`settings-tab ${activeTab === 'select' ? 'active' : ''}`}
            onClick={() => setActiveTab('select')}
          >
            Select Config
          </button>
          <button
            className={`settings-tab ${activeTab === 'llm-configs' ? 'active' : ''}`}
            onClick={() => setActiveTab('llm-configs')}
          >
            LLM Configs
          </button>
          <button
            className={`settings-tab ${activeTab === 'slack-apps' ? 'active' : ''}`}
            onClick={() => setActiveTab('slack-apps')}
          >
            Slack Apps
          </button>
        </div>

        {/* Tab Content */}
        <div className="settings-content">
          {/* Select Config Tab */}
          {activeTab === 'select' && (
            <div className="config-select-tab">
              <p style={{ marginBottom: '1rem', color: 'rgba(255,255,255,0.7)' }}>
                Select an LLM configuration to use for chat:
              </p>
              {llmConfigs.length === 0 ? (
                <div className="empty-state">
                  No LLM configs found. Create one in the "LLM Configs" tab.
                </div>
              ) : (
                <div className="config-list">
                  {llmConfigs.map((config) => (
                    <div
                      key={config.name}
                      className={`config-item ${selectedConfigName === config.name ? 'selected' : ''}`}
                      onClick={() => handleSelectConfig(config.name)}
                    >
                      <div className="config-item-header">
                        <span className="config-name">{config.name}</span>
                        {selectedConfigName === config.name && (
                          <span className="config-selected-badge">Selected</span>
                        )}
                      </div>
                      <div className="config-item-details">
                        <span>{config.provider}</span>
                        <span>•</span>
                        <span>{config.model}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* LLM Configs Tab */}
          {activeTab === 'llm-configs' && (
            <div className="llm-configs-tab">
              {editingLlmConfig ? (
                <div className="config-form">
                  <h3>{isNewLlmConfig ? 'New LLM Config' : `Edit: ${editingLlmConfig.name}`}</h3>

                  <div className="form-group">
                    <label>Name *</label>
                    <input
                      type="text"
                      value={editingLlmConfig.name}
                      onChange={(e) => setEditingLlmConfig({ ...editingLlmConfig, name: e.target.value })}
                      disabled={!isNewLlmConfig}
                      placeholder="e.g., claude-sonnet"
                    />
                  </div>

                  <div className="form-group">
                    <label>Provider *</label>
                    <select
                      value={editingLlmConfig.provider}
                      onChange={(e) => setEditingLlmConfig({ ...editingLlmConfig, provider: e.target.value })}
                    >
                      <option value="">Select provider</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="openai">OpenAI</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Base URL *</label>
                    <input
                      type="text"
                      value={editingLlmConfig.base_url}
                      onChange={(e) => setEditingLlmConfig({ ...editingLlmConfig, base_url: e.target.value })}
                      placeholder="https://api.anthropic.com"
                    />
                  </div>

                  <div className="form-group">
                    <label>API Key {isNewLlmConfig ? '*' : '(leave blank to keep existing)'}</label>
                    <input
                      type="password"
                      value={editingLlmConfig.api_key || ''}
                      onChange={(e) => setEditingLlmConfig({ ...editingLlmConfig, api_key: e.target.value })}
                      placeholder={isNewLlmConfig ? 'sk-...' : '••••••••'}
                    />
                  </div>

                  <div className="form-group">
                    <label>Model *</label>
                    <input
                      type="text"
                      value={editingLlmConfig.model}
                      onChange={(e) => setEditingLlmConfig({ ...editingLlmConfig, model: e.target.value })}
                      placeholder="claude-sonnet-4-20250514"
                    />
                  </div>

                  <div className="form-actions">
                    <button onClick={() => { setEditingLlmConfig(null); setIsNewLlmConfig(false) }}>
                      Cancel
                    </button>
                    <button className="primary" onClick={handleSaveLlmConfig}>
                      {isNewLlmConfig ? 'Create' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    className="add-btn"
                    onClick={() => {
                      setEditingLlmConfig({ name: '', provider: '', base_url: '', model: '' })
                      setIsNewLlmConfig(true)
                    }}
                  >
                    + Add LLM Config
                  </button>

                  {llmConfigs.length === 0 ? (
                    <div className="empty-state">No LLM configs found</div>
                  ) : (
                    <div className="config-list">
                      {llmConfigs.map((config) => (
                        <div key={config.name} className="config-item">
                          <div className="config-item-header">
                            <span className="config-name">{config.name}</span>
                            <div className="config-actions">
                              <button onClick={() => { setEditingLlmConfig(config); setIsNewLlmConfig(false) }}>
                                Edit
                              </button>
                              <button className="danger" onClick={() => handleDeleteLlmConfig(config.name)}>
                                Delete
                              </button>
                            </div>
                          </div>
                          <div className="config-item-details">
                            <span>{config.provider}</span>
                            <span>•</span>
                            <span>{config.model}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Slack Apps Tab */}
          {activeTab === 'slack-apps' && (
            <div className="slack-apps-tab">
              {editingSlackApp ? (
                <div className="config-form">
                  <h3>{isNewSlackApp ? 'New Slack App' : `Edit: ${editingSlackApp.app_name}`}</h3>

                  <div className="form-group">
                    <label>App ID *</label>
                    <input
                      type="text"
                      value={editingSlackApp.app_id}
                      onChange={(e) => setEditingSlackApp({ ...editingSlackApp, app_id: e.target.value })}
                      disabled={!isNewSlackApp}
                      placeholder="A0XXXXXXX"
                    />
                    <small>Find this in your Slack App settings</small>
                  </div>

                  <div className="form-group">
                    <label>App Name *</label>
                    <input
                      type="text"
                      value={editingSlackApp.app_name}
                      onChange={(e) => setEditingSlackApp({ ...editingSlackApp, app_name: e.target.value })}
                      placeholder="My Claude Bot"
                    />
                  </div>

                  <div className="form-group">
                    <label>Bot Token {isNewSlackApp ? '*' : '(leave blank to keep existing)'}</label>
                    <input
                      type="password"
                      value={editingSlackApp.bot_token || ''}
                      onChange={(e) => setEditingSlackApp({ ...editingSlackApp, bot_token: e.target.value })}
                      placeholder={isNewSlackApp ? 'xoxb-...' : '••••••••'}
                    />
                  </div>

                  <div className="form-group">
                    <label>Signing Secret {isNewSlackApp ? '*' : '(leave blank to keep existing)'}</label>
                    <input
                      type="password"
                      value={editingSlackApp.signing_secret || ''}
                      onChange={(e) => setEditingSlackApp({ ...editingSlackApp, signing_secret: e.target.value })}
                      placeholder={isNewSlackApp ? 'Signing secret from Slack' : '••••••••'}
                    />
                  </div>

                  <div className="form-group">
                    <label>LLM Config *</label>
                    <select
                      value={editingSlackApp.llm_config_name}
                      onChange={(e) => setEditingSlackApp({ ...editingSlackApp, llm_config_name: e.target.value })}
                    >
                      <option value="">Select config</option>
                      {llmConfigs.map((config) => (
                        <option key={config.name} value={config.name}>
                          {config.name} ({config.provider} / {config.model})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Team ID (optional)</label>
                    <input
                      type="text"
                      value={editingSlackApp.team_id || ''}
                      onChange={(e) => setEditingSlackApp({ ...editingSlackApp, team_id: e.target.value })}
                      placeholder="T0XXXXXXX"
                    />
                  </div>

                  <div className="form-group">
                    <label>Custom System Prompt (optional)</label>
                    <textarea
                      value={editingSlackApp.system_prompt || ''}
                      onChange={(e) => setEditingSlackApp({ ...editingSlackApp, system_prompt: e.target.value })}
                      placeholder="Override the default system prompt for this bot..."
                      rows={4}
                    />
                  </div>

                  <div className="form-actions">
                    <button onClick={() => { setEditingSlackApp(null); setIsNewSlackApp(false) }}>
                      Cancel
                    </button>
                    <button className="primary" onClick={handleSaveSlackApp}>
                      {isNewSlackApp ? 'Create' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    className="add-btn"
                    onClick={() => {
                      setEditingSlackApp({ app_id: '', app_name: '', llm_config_name: '' })
                      setIsNewSlackApp(true)
                    }}
                  >
                    + Add Slack App
                  </button>

                  {slackApps.length === 0 ? (
                    <div className="empty-state">No Slack apps found</div>
                  ) : (
                    <div className="config-list">
                      {slackApps.map((app) => (
                        <div key={app.app_id} className="config-item">
                          <div className="config-item-header">
                            <span className="config-name">{app.app_name}</span>
                            <div className="config-actions">
                              <button onClick={() => { setEditingSlackApp(app); setIsNewSlackApp(false) }}>
                                Edit
                              </button>
                              <button className="danger" onClick={() => handleDeleteSlackApp(app.app_id)}>
                                Delete
                              </button>
                            </div>
                          </div>
                          <div className="config-item-details">
                            <span>{app.app_id}</span>
                            <span>•</span>
                            <span>LLM: {app.llm_config_name}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
