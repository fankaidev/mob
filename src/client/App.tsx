import React, { useState, useEffect, useRef } from 'react'
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
}

interface Session {
  id: string
  created_at: number
  updated_at: number
  status: string
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [selectedConfig, setSelectedConfig] = useState<LLMConfig | null>(null)
  const [selectedConfigName, setSelectedConfigName] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Initialize session ID and load saved config
  useEffect(() => {
    let sid = localStorage.getItem('mob-session-id')
    if (!sid) {
      sid = crypto.randomUUID()
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
  }, [])

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
      const response = await fetch(`/api/session/${sid}/history`)
      if (response.ok) {
        const data = await response.json() as { messages: any[] }
        const historyMessages: Message[] = []

        data.messages.forEach((msg: any) => {
          if (msg.role === 'user' && msg.content) {
            if (Array.isArray(msg.content)) {
              const text = msg.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('')
              if (text) {
                historyMessages.push({ role: 'user', content: text })
              }
            } else if (typeof msg.content === 'string') {
              historyMessages.push({ role: 'user', content: msg.content })
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
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined
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

  const createNewSession = () => {
    const newSessionId = crypto.randomUUID()
    const now = Date.now()

    localStorage.setItem('mob-session-id', newSessionId)
    setSessionId(newSessionId)
    setMessages([])

    const newSession: Session = {
      id: newSessionId,
      created_at: now,
      updated_at: now,
      status: 'active'
    }
    setSessions([newSession, ...sessions])
  }

  const switchSession = (sid: string) => {
    localStorage.setItem('mob-session-id', sid)
    setSessionId(sid)
    loadHistory(sid)
    setIsSidebarOpen(false)
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!selectedConfig) {
      setIsSettingsOpen(true)
      return
    }

    const message = inputValue.trim()
    if (!message) return

    setMessages([...messages, { role: 'user', content: message }])
    setInputValue('')
    setIsLoading(true)

    const loadingMessage: Message = { role: 'assistant', content: '...' }
    setMessages(prev => [...prev, loadingMessage])

    try {
      const response = await fetch(`/api/session/${sessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          baseUrl: selectedConfig.base_url,
          apiKey: selectedConfig.api_key,
          model: selectedConfig.model,
          provider: selectedConfig.provider
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
              if (event.type === 'text') {
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
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Sidebar */}
      <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h3>Sessions</h3>
          <button className="close-sidebar-btn" onClick={() => setIsSidebarOpen(false)}>×</button>
        </div>
        <button className="new-chat-btn" onClick={createNewSession}>
          + New Chat
        </button>
        <div className="sessions-list">
          {sessions.length === 0 ? (
            <div style={{ padding: '1rem', color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
              No sessions yet
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={`session-item ${session.id === sessionId ? 'active' : ''}`}
                onClick={() => switchSession(session.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="session-name">
                      {session.id.slice(0, 8)}...
                    </div>
                    <div className="session-date">
                      {formatDateTime(session.updated_at)}
                    </div>
                  </div>
                  <button
                    className="delete-session-btn"
                    onClick={(e) => deleteSession(session.id, e)}
                    title="Delete session"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <header>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button className="menu-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
              ☰
            </button>
            <h1>Mob Chat</h1>
            {selectedConfigName && (
              <span className="config-badge">{selectedConfigName}</span>
            )}
          </div>
          <button className="settings-btn" onClick={() => setIsSettingsOpen(true)}>
            Settings
          </button>
        </header>

        <div id="messages">
          {messages.map((msg, idx) => (
            <ChatMessage
              key={idx}
              role={msg.role}
              content={msg.content}
              toolCalls={msg.toolCalls}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form id="input-form" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            id="message-input"
            placeholder={selectedConfig ? "Type your message..." : "Select a config in Settings first..."}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isLoading || !selectedConfig}
          />
          <button type="submit" disabled={isLoading || !selectedConfig}>Send</button>
        </form>
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSelectConfig={handleSelectConfig}
        selectedConfigName={selectedConfigName}
      />
    </div>
  )
}
