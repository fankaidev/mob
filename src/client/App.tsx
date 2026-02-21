import React, { useEffect, useRef, useState } from 'react'
import { generateSessionId } from '../lib/utils'
import { ChatMessage } from './components/ChatMessage'
import { SettingsModal } from './components/SettingsModal'

interface ToolCall {
  name: string
  args: any
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
  prefix?: string  // Optional speaker prefix (e.g., "user:Kai", "bot:AppName")
}

interface Session {
  id: string
  created_at: number
  updated_at: number
  status: string
  first_user_message?: string
}

interface LLMConfig {
  name: string
  provider: string
  base_url: string
  api_key?: string
  model: string
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [selectedConfig, setSelectedConfig] = useState<LLMConfig | null>(null)
  const [selectedConfigName, setSelectedConfigName] = useState<string | null>(null)
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[]>([])
  const [isConfigDropdownOpen, setIsConfigDropdownOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsConfigDropdownOpen(false)
      }
    }

    if (isConfigDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isConfigDropdownOpen])

  // Initialize session ID and load saved config
  useEffect(() => {
    let sid = localStorage.getItem('mob-session-id')
    if (!sid) {
      // Generate session ID in format: web-YYYYMMDDTHHmmssZ-{random}
      sid = generateSessionId('web')
      localStorage.setItem('mob-session-id', sid)
    }
    setSessionId(sid)

    // Load saved config name from localStorage
    const savedConfigName = localStorage.getItem('selected-llm-config')
    if (savedConfigName) {
      setSelectedConfigName(savedConfigName)
      // Try to load the full config
      loadSelectedConfig(savedConfigName)
    } else {
      // No config selected, open settings
      setIsSettingsOpen(true)
    }

    loadHistory(sid)
    loadSessions()
    loadLlmConfigs()
  }, [])

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

  const loadSelectedConfig = async (configName: string) => {
    try {
      const response = await fetch(`/api/admin/llm-configs/${configName}`)
      if (response.ok) {
        const data = await response.json() as { config: LLMConfig }
        setSelectedConfig(data.config)
        setSelectedConfigName(configName)
      } else {
        // Config not found, clear selection
        localStorage.removeItem('selected-llm-config')
        setSelectedConfigName(null)
        setSelectedConfig(null)
        setIsSettingsOpen(true)
      }
    } catch (error) {
      console.error('Failed to load selected config:', error)
    }
  }

  const loadSessions = async () => {
    try {
      const response = await fetch('/api/sessions')
      if (response.ok) {
        const data = await response.json() as { sessions: Session[] }
        setSessions(data.sessions)
      }
    } catch (error) {
      console.error('Failed to load sessions:', error)
    }
  }

  const loadHistory = async (sid: string) => {
    try {
      console.log('Loading history for session:', sid)
      const response = await fetch(`/api/session/${sid}/history`)
      if (response.ok) {
        const data = await response.json() as { messages: any[] }
        console.log('History response:', { messageCount: data.messages.length })
        const historyMessages: Message[] = []

        data.messages.forEach((msg: any) => {
          if (msg.role === 'user' && msg.content) {
            if (Array.isArray(msg.content)) {
              const text = msg.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('')
              if (text) {
                historyMessages.push({
                  role: 'user',
                  content: text,
                  prefix: msg.prefix  // Include prefix if available
                })
              }
            } else if (typeof msg.content === 'string') {
              historyMessages.push({
                role: 'user',
                content: msg.content,
                prefix: msg.prefix
              })
            }
          } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            const text = msg.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('')

            const toolCalls = msg.content
              .filter((c: any) => c.type === 'toolCall')
              .map((c: any) => ({
                name: c.name,
                args: c.arguments
              }))

            if (text || toolCalls.length > 0) {
              historyMessages.push({
                role: 'assistant',
                content: text,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                prefix: msg.prefix  // Include prefix if available
              })
            }
          }
        })

        setMessages(historyMessages)
      }
    } catch (error) {
      console.error('Failed to load history:', error)
    }
  }

  const createNewSession = async () => {
    // Generate session ID in format: YYYYMMDDTHHmmssZ-{random}
    const newSessionId = generateSessionId('web')
    const timestamp = new Date().getTime()

    localStorage.setItem('mob-session-id', newSessionId)
    setSessionId(newSessionId)
    setMessages([])

    const newSession: Session = {
      id: newSessionId,
      created_at: timestamp,
      updated_at: timestamp,
      status: 'active'
    }
    setSessions([newSession, ...sessions])

    // Persist session to database by initializing the DO
    try {
      await fetch(`/api/session/${newSessionId}/init`, { method: 'POST' })
    } catch (error) {
      console.error('Failed to initialize session:', error)
    }
  }

  const switchSession = (sid: string) => {
    localStorage.setItem('mob-session-id', sid)
    setSessionId(sid)
    loadHistory(sid)
    // Only close sidebar on mobile (screen width < 769px)
    if (window.innerWidth < 769) {
      setIsSidebarOpen(false)
    }
  }

  const deleteSession = async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation()

    if (!confirm('Are you sure you want to delete this session?')) {
      return
    }

    try {
      const response = await fetch(`/api/session/${sid}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        if (sid === sessionId) {
          createNewSession()
        } else {
          loadSessions()
        }
      }
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }

  const formatDateTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const dateStr = date.toLocaleDateString()
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
    return `${dateStr} ${timeStr}`
  }

  const handleSelectConfig = (config: LLMConfig | null) => {
    setSelectedConfig(config)
    if (config) {
      setSelectedConfigName(config.name)
      localStorage.setItem('selected-llm-config', config.name)
    } else {
      setSelectedConfigName(null)
      localStorage.removeItem('selected-llm-config')
    }
  }

  const handleQuickSwitchConfig = (configName: string) => {
    loadSelectedConfig(configName)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!selectedConfig) {
      setIsSettingsOpen(true)
      return
    }

    const messageText = inputValue.trim()
    if (!messageText) return

    setMessages([...messages, { role: 'user', content: messageText }])
    setInputValue('')
    setIsLoading(true)

    const loadingMessage: Message = { role: 'assistant', content: '...' }
    setMessages(prev => [...prev, loadingMessage])

    // Construct AgentMessage object
    const agentMessage = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: messageText }],
      timestamp: Date.now()
    }

    try {
      const response = await fetch(`/api/session/${sessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: agentMessage,
          llmConfigName: selectedConfigName  // Only send config name, not the actual API key
        }),
      })

      if (!response.ok) throw new Error('Request failed')

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let assistantMessage = ''
      let currentToolCalls: ToolCall[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const event = JSON.parse(data)
              if (event.type === 'session_id') {
                // Verify session ID matches
                if (event.sessionId && event.sessionId !== sessionId) {
                  const error = `Session ID mismatch! Expected: ${sessionId}, Got: ${event.sessionId}`
                  console.error(error)
                  throw new Error(error)
                }
              } else if (event.type === 'text') {
                assistantMessage += event.text
                setMessages(prev => {
                  const newMessages = [...prev]
                  newMessages[newMessages.length - 1] = {
                    role: 'assistant',
                    content: assistantMessage,
                    toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined
                  }
                  return newMessages
                })
              } else if (event.type === 'tool_call_start') {
                currentToolCalls.push({
                  name: event.toolName,
                  args: event.args
                })
                setMessages(prev => {
                  const newMessages = [...prev]
                  newMessages[newMessages.length - 1] = {
                    role: 'assistant',
                    content: assistantMessage,
                    toolCalls: [...currentToolCalls]
                  }
                  return newMessages
                })
              } else if (event.type === 'error') {
                throw new Error(event.error)
              }
            } catch (e) {
              console.error('Parse error:', e)
            }
          }
        }
      }

      if (!assistantMessage) {
        setMessages(prev => {
          const newMessages = [...prev]
          newMessages[newMessages.length - 1] = {
            role: 'assistant',
            content: 'No response generated.'
          }
          return newMessages
        })
      }

    } catch (error) {
      setMessages(prev => {
        const newMessages = [...prev]
        newMessages[newMessages.length - 1] = {
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
        return newMessages
      })
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="flex h-screen bg-[#f7f7f8]">
      {/* Sidebar */}
      <div className={`${isSidebarOpen ? 'w-64' : 'w-0'} transition-all duration-200 bg-white overflow-hidden flex-shrink-0 border-r border-[#d9d9e3]`}>
        <div className="flex flex-col h-full w-64">
          <div className="flex-1 overflow-y-auto pt-2">
            <div className="px-2 pb-2">
              {sessions.length === 0 ? (
                <div className="py-8 text-center text-[#6b7280] text-xs">
                  No chats yet
                </div>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`group relative mb-1 px-3 py-2.5 rounded-md cursor-pointer hover:bg-[#ececf1] transition-colors ${
                      session.id === sessionId ? 'bg-[#ececf1]' : ''
                    }`}
                    onClick={() => switchSession(session.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate text-[#353740]">
                          {(() => {
                            if (!session.first_user_message) {
                              return 'New chat'
                            }
                            try {
                              const msg = JSON.parse(session.first_user_message)
                              const textContent = msg.content?.find((c: any) => c.type === 'text')?.text || ''
                              return textContent.slice(0, 30) || 'New chat'
                            } catch {
                              return session.first_user_message
                            }
                          })()}
                        </div>
                        <div className="text-xs text-[#6b7280] mt-1">
                          {formatDateTime(session.updated_at)}
                        </div>
                        <div className="text-xs text-[#6b7280] truncate mt-0.5">
                          {session.id}
                        </div>
                      </div>
                      <button
                        className="h-6 w-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white rounded flex-shrink-0"
                        onClick={(e) => deleteSession(session.id, e)}
                        title="Delete"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="bg-white px-4 py-2.5 flex items-center justify-between border-b border-[#d9d9e3]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="h-8 w-8 flex items-center justify-center hover:bg-[#ececf1] rounded-md transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>

            {/* LLM Config Dropdown */}
            {selectedConfigName && (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setIsConfigDropdownOpen(!isConfigDropdownOpen)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold hover:bg-[#ececf1] rounded-md transition-colors"
                >
                  {selectedConfigName}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform" style={{ transform: isConfigDropdownOpen ? 'rotate(180deg)' : 'rotate(0)' }}>
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>

                {isConfigDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-[#d9d9e3] rounded-lg shadow-lg z-50">
                    <div className="px-3 py-2 text-xs font-semibold text-[#6b7280] border-b border-[#d9d9e3]">
                      Switch Model
                    </div>
                    <div className="py-1">
                      {llmConfigs.map((config) => (
                        <button
                          key={config.name}
                          onClick={() => {
                            handleQuickSwitchConfig(config.name)
                            setIsConfigDropdownOpen(false)
                          }}
                          className={`w-full px-3 py-2 text-left hover:bg-[#ececf1] transition-colors ${
                            config.name === selectedConfigName ? 'bg-[#ececf1]' : ''
                          }`}
                        >
                          <div className="flex flex-col">
                            <span className="font-medium text-sm text-[#353740]">{config.name}</span>
                            <span className="text-xs text-[#6b7280]">
                              {config.provider} · {config.model}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-[#d9d9e3]">
                      <button
                        onClick={() => {
                          setIsSettingsOpen(true)
                          setIsConfigDropdownOpen(false)
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-[#ececf1] transition-colors flex items-center gap-2"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                        Settings
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={createNewSession}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-[#d9d9e3] rounded-md hover:bg-[#ececf1] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            New chat
          </button>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6">
            {messages.map((msg, idx) => (
              <ChatMessage
                key={idx}
                role={msg.role}
                content={msg.content}
                toolCalls={msg.toolCalls}
                prefix={msg.prefix}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Form */}
        <div className="border-t border-[#d9d9e3] bg-white px-4 py-4">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
            <div className="relative flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                className="flex-1 rounded-xl border border-[#d9d9e3] bg-[#f7f7f8] px-4 py-3 text-sm shadow-sm placeholder:text-[#6b7280] focus:outline-none focus:border-[#10a37f] disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                placeholder={selectedConfig ? "Message Mob..." : "Select a model first..."}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={isLoading || !selectedConfig}
              />
              <button
                type="submit"
                disabled={isLoading || !selectedConfig}
                className="h-10 w-10 rounded-lg bg-[#10a37f] text-white flex items-center justify-center hover:bg-[#0e9070] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M.5 1.163A1 1 0 0 1 1.97.28l12.868 6.837a1 1 0 0 1 0 1.766L1.969 15.72A1 1 0 0 1 .5 14.836V10.33a1 1 0 0 1 .816-.983L8.5 8 1.316 6.653A1 1 0 0 1 .5 5.67V1.163Z" fill="currentColor"/>
                </svg>
              </button>
            </div>
          </form>
        </div>
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false)
          loadLlmConfigs()
        }}
        onSelectConfig={handleSelectConfig}
        selectedConfigName={selectedConfigName}
      />
    </div>
  )
}
