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
    <div className="fixed top-0 left-0 w-full h-full bg-black/50 z-[1000] flex items-center justify-center" onClick={onClose}>
      <div className="bg-white p-8 rounded-lg w-[90%] max-w-[700px] max-h-[90vh] shadow-[0_10px_25px_rgba(0,0,0,0.2)] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Settings</h2>
          <button className="bg-none border-none text-2xl cursor-pointer text-[#6b7280] p-0 w-8 h-8 hover:text-[#1f2937]" onClick={onClose}>×</button>
        </div>

        {status && (
          <div className={`p-3 rounded-lg mb-4 text-sm ${
            status.type === 'success' ? 'bg-[#dcfce7] text-[#166534]' :
            status.type === 'error' ? 'bg-[#fee2e2] text-[#991b1b]' :
            'bg-[#fef3c7] text-[#92400e]'
          }`}>
            {status.message}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-[#e5e7eb] mb-4 gap-2">
          <button
            className={`px-4 py-3 bg-none border-none border-b-2 ${
              activeTab === 'select'
                ? 'border-b-[#2563eb] text-[#2563eb]'
                : 'border-b-transparent text-[#6b7280] hover:text-[#374151] hover:bg-[#f9fafb]'
            } cursor-pointer text-sm font-medium transition-all`}
            onClick={() => setActiveTab('select')}
          >
            Select Config
          </button>
          <button
            className={`px-4 py-3 bg-none border-none border-b-2 ${
              activeTab === 'llm-configs'
                ? 'border-b-[#2563eb] text-[#2563eb]'
                : 'border-b-transparent text-[#6b7280] hover:text-[#374151] hover:bg-[#f9fafb]'
            } cursor-pointer text-sm font-medium transition-all`}
            onClick={() => setActiveTab('llm-configs')}
          >
            LLM Configs
          </button>
          <button
            className={`px-4 py-3 bg-none border-none border-b-2 ${
              activeTab === 'slack-apps'
                ? 'border-b-[#2563eb] text-[#2563eb]'
                : 'border-b-transparent text-[#6b7280] hover:text-[#374151] hover:bg-[#f9fafb]'
            } cursor-pointer text-sm font-medium transition-all`}
            onClick={() => setActiveTab('slack-apps')}
          >
            Slack Apps
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto min-h-[300px]">
          {/* Select Config Tab */}
          {activeTab === 'select' && (
            <div>
              <p className="mb-4 text-[#6b7280]">
                Select an LLM configuration to use for chat:
              </p>
              {llmConfigs.length === 0 ? (
                <div className="text-center py-8 text-[#6b7280]">
                  No LLM configs found. Create one in the "LLM Configs" tab.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {llmConfigs.map((config) => (
                    <div
                      key={config.name}
                      className={`p-4 border rounded-lg cursor-pointer transition-all ${
                        selectedConfigName === config.name
                          ? 'border-[#2563eb] bg-[#eff6ff]'
                          : 'border-[#e5e7eb] hover:border-[#2563eb] hover:bg-[#f0f9ff]'
                      }`}
                      onClick={() => handleSelectConfig(config.name)}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-[#1f2937]">{config.name}</span>
                        {selectedConfigName === config.name && (
                          <span className="bg-[#2563eb] text-white px-2 py-1 rounded text-xs font-medium">Selected</span>
                        )}
                      </div>
                      <div className="flex gap-2 text-sm text-[#6b7280]">
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
            <div>
              {editingLlmConfig ? (
                <div className="p-2">
                  <h3 className="text-lg mb-4 text-[#1f2937]">{isNewLlmConfig ? 'New LLM Config' : `Edit: ${editingLlmConfig.name}`}</h3>

                  <div className="mb-4">
                    <label className="block font-medium mb-2 text-[#374151]">Name *</label>
                    <input
                      type="text"
                      className="w-full px-3 py-3 border border-[#d1d5db] rounded-lg text-base focus:outline-none focus:border-[#2563eb] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]"
                      value={editingLlmConfig.name}
                      onChange={(e) => setEditingLlmConfig({ ...editingLlmConfig, name: e.target.value })}
                      disabled={!isNewLlmConfig}
                      placeholder="e.g., claude-sonnet"
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block font-medium mb-2 text-[#374151]">Provider *</label>
                    <select
                      className="w-full px-3 py-3 border border-[#d1d5db] rounded-lg text-base bg-white cursor-pointer focus:outline-none focus:border-[#2563eb] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]"
                      value={editingLlmConfig.provider}
                      onChange={(e) => setEditingLlmConfig({ ...editingLlmConfig, provider: e.target.value })}
                    >
                      <option value="">Select provider</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="openai">OpenAI</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </div>

                  <div className="mb-4">
                    <label className="block font-medium mb-2 text-[#374151]">Base URL *</label>
                    <input
                      type="text"
                      className="w-full px-3 py-3 border border-[#d1d5db] rounded-lg text-base focus:outline-none focus:border-[#2563eb] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]"
                      value={editingLlmConfig.base_url}
                      onChange={(e) => setEditingLlmConfig({ ...editingLlmConfig, base_url: e.target.value })}
                      placeholder="https://api.anthropic.com"
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block font-medium mb-2 text-[#374151]">API Key {isNewLlmConfig ? '*' : '(leave blank to keep existing)'}</label>
                    <input
                      type="password"
                      className="w-full px-3 py-3 border border-[#d1d5db] rounded-lg text-base focus:outline-none focus:border-[#2563eb] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]"
                      value={editingLlmConfig.api_key || ''}
                      onChange={(e) => setEditingLlmConfig({ ...editingLlmConfig, api_key: e.target.value })}
                      placeholder={isNewLlmConfig ? 'sk-...' : '••••••••'}
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block font-medium mb-2 text-[#374151]">Model *</label>
                    <input
                      type="text"
                      className="w-full px-3 py-3 border border-[#d1d5db] rounded-lg text-base focus:outline-none focus:border-[#2563eb] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]"
                      value={editingLlmConfig.model}
                      onChange={(e) => setEditingLlmConfig({ ...editingLlmConfig, model: e.target.value })}
                      placeholder="claude-sonnet-4-20250514"
                    />
                  </div>

                  <div className="flex gap-2 justify-end mt-6 pt-4 border-t border-[#e5e7eb]">
                    <button
                      className="px-4 py-2 bg-[#f3f4f6] text-[#374151] border-none rounded-lg text-base cursor-pointer font-medium hover:bg-[#e5e7eb]"
                      onClick={() => { setEditingLlmConfig(null); setIsNewLlmConfig(false) }}
                    >
                      Cancel
                    </button>
                    <button
                      className="px-4 py-2 bg-[#2563eb] text-white border-none rounded-lg text-base cursor-pointer font-medium hover:bg-[#1d4ed8]"
                      onClick={handleSaveLlmConfig}
                    >
                      {isNewLlmConfig ? 'Create' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    className="w-full px-3 py-3 mb-4 bg-[#f3f4f6] text-[#374151] border-2 border-dashed border-[#d1d5db] rounded-lg cursor-pointer font-medium hover:bg-[#e5e7eb] hover:border-[#9ca3af]"
                    onClick={() => {
                      setEditingLlmConfig({ name: '', provider: '', base_url: '', model: '' })
                      setIsNewLlmConfig(true)
                    }}
                  >
                    + Add LLM Config
                  </button>

                  {llmConfigs.length === 0 ? (
                    <div className="text-center py-8 text-[#6b7280]">No LLM configs found</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {llmConfigs.map((config) => (
                        <div key={config.name} className="p-4 border border-[#e5e7eb] rounded-lg">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-semibold text-[#1f2937]">{config.name}</span>
                            <div className="flex gap-2">
                              <button
                                className="px-3 py-1 text-xs bg-[#f3f4f6] text-[#374151] border-none rounded-lg cursor-pointer hover:bg-[#e5e7eb]"
                                onClick={() => { setEditingLlmConfig(config); setIsNewLlmConfig(false) }}
                              >
                                Edit
                              </button>
                              <button
                                className="px-3 py-1 text-xs bg-[#fef2f2] text-[#dc2626] border-none rounded-lg cursor-pointer hover:bg-[#fee2e2]"
                                onClick={() => handleDeleteLlmConfig(config.name)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          <div className="flex gap-2 text-sm text-[#6b7280]">
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
            <div>
              {editingSlackApp ? (
                <div className="p-2">
                  <h3 className="text-lg mb-4 text-[#1f2937]">{isNewSlackApp ? 'New Slack App' : `Edit: ${editingSlackApp.app_name}`}</h3>

                  <div className="mb-4">
                    <label className="block font-medium mb-2 text-[#374151]">App ID *</label>
                    <input
                      type="text"
                      className="w-full px-3 py-3 border border-[#d1d5db] rounded-lg text-base focus:outline-none focus:border-[#2563eb] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]"
                      value={editingSlackApp.app_id}
                      onChange={(e) => setEditingSlackApp({ ...editingSlackApp, app_id: e.target.value })}
                      disabled={!isNewSlackApp}
                      placeholder="A0XXXXXXX"
                    />
                    <small className="block mt-1 text-[#6b7280] text-sm">Find this in your Slack App settings</small>
                  </div>

                  <div className="mb-4">
                    <label className="block font-medium mb-2 text-[#374151]">App Name *</label>
                    <input
                      type="text"
                      className="w-full px-3 py-3 border border-[#d1d5db] rounded-lg text-base focus:outline-none focus:border-[#2563eb] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]"
                      value={editingSlackApp.app_name}
                      onChange={(e) => setEditingSlackApp({ ...editingSlackApp, app_name: e.target.value })}
                      placeholder="My Claude Bot"
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block font-medium mb-2 text-[#374151]">Bot Token {isNewSlackApp ? '*' : '(leave blank to keep existing)'}</label>
                    <input
                      type="password"
                      className="w-full px-3 py-3 border border-[#d1d5db] rounded-lg text-base focus:outline-none focus:border-[#2563eb] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]"
                      value={editingSlackApp.bot_token || ''}
                      onChange={(e) => setEditingSlackApp({ ...editingSlackApp, bot_token: e.target.value })}
                      placeholder={isNewSlackApp ? 'xoxb-...' : '••••••••'}
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block font-medium mb-2 text-[#374151]">Signing Secret {isNewSlackApp ? '*' : '(leave blank to keep existing)'}</label>
                    <input
                      type="password"
                      className="w-full px-3 py-3 border border-[#d1d5db] rounded-lg text-base focus:outline-none focus:border-[#2563eb] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]"
                      value={editingSlackApp.signing_secret || ''}
                      onChange={(e) => setEditingSlackApp({ ...editingSlackApp, signing_secret: e.target.value })}
                      placeholder={isNewSlackApp ? 'Signing secret from Slack' : '••••••••'}
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block font-medium mb-2 text-[#374151]">LLM Config *</label>
                    <select
                      className="w-full px-3 py-3 border border-[#d1d5db] rounded-lg text-base bg-white cursor-pointer focus:outline-none focus:border-[#2563eb] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]"
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

                  <div className="mb-4">
                    <label className="block font-medium mb-2 text-[#374151]">Team ID (optional)</label>
                    <input
                      type="text"
                      className="w-full px-3 py-3 border border-[#d1d5db] rounded-lg text-base focus:outline-none focus:border-[#2563eb] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]"
                      value={editingSlackApp.team_id || ''}
                      onChange={(e) => setEditingSlackApp({ ...editingSlackApp, team_id: e.target.value })}
                      placeholder="T0XXXXXXX"
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block font-medium mb-2 text-[#374151]">Custom System Prompt (optional)</label>
                    <textarea
                      className="w-full px-3 py-3 border border-[#d1d5db] rounded-lg text-base font-[inherit] resize-y min-h-[80px] focus:outline-none focus:border-[#2563eb] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.1)]"
                      value={editingSlackApp.system_prompt || ''}
                      onChange={(e) => setEditingSlackApp({ ...editingSlackApp, system_prompt: e.target.value })}
                      placeholder="Override the default system prompt for this bot..."
                      rows={4}
                    />
                  </div>

                  <div className="flex gap-2 justify-end mt-6 pt-4 border-t border-[#e5e7eb]">
                    <button
                      className="px-4 py-2 bg-[#f3f4f6] text-[#374151] border-none rounded-lg text-base cursor-pointer font-medium hover:bg-[#e5e7eb]"
                      onClick={() => { setEditingSlackApp(null); setIsNewSlackApp(false) }}
                    >
                      Cancel
                    </button>
                    <button
                      className="px-4 py-2 bg-[#2563eb] text-white border-none rounded-lg text-base cursor-pointer font-medium hover:bg-[#1d4ed8]"
                      onClick={handleSaveSlackApp}
                    >
                      {isNewSlackApp ? 'Create' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    className="w-full px-3 py-3 mb-4 bg-[#f3f4f6] text-[#374151] border-2 border-dashed border-[#d1d5db] rounded-lg cursor-pointer font-medium hover:bg-[#e5e7eb] hover:border-[#9ca3af]"
                    onClick={() => {
                      setEditingSlackApp({ app_id: '', app_name: '', llm_config_name: '' })
                      setIsNewSlackApp(true)
                    }}
                  >
                    + Add Slack App
                  </button>

                  {slackApps.length === 0 ? (
                    <div className="text-center py-8 text-[#6b7280]">No Slack apps found</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {slackApps.map((app) => (
                        <div key={app.app_id} className="p-4 border border-[#e5e7eb] rounded-lg">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-semibold text-[#1f2937]">{app.app_name}</span>
                            <div className="flex gap-2">
                              <button
                                className="px-3 py-1 text-xs bg-[#f3f4f6] text-[#374151] border-none rounded-lg cursor-pointer hover:bg-[#e5e7eb]"
                                onClick={() => { setEditingSlackApp(app); setIsNewSlackApp(false) }}
                              >
                                Edit
                              </button>
                              <button
                                className="px-3 py-1 text-xs bg-[#fef2f2] text-[#dc2626] border-none rounded-lg cursor-pointer hover:bg-[#fee2e2]"
                                onClick={() => handleDeleteSlackApp(app.app_id)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          <div className="flex gap-2 text-sm text-[#6b7280]">
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
