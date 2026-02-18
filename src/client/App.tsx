import React, { useState, useEffect, useRef } from 'react'
import { ChatMessage } from './components/ChatMessage'
import { SettingsModal } from './components/SettingsModal'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Session {
  id: string
  created_at: number
  updated_at: number
  status: string
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [settings, setSettings] = useState({
    baseUrl: '',
    apiKey: '',
    model: '',
    provider: ''
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Initialize session ID and settings
  useEffect(() => {
    let sid = localStorage.getItem('mob-session-id')
    if (!sid) {
      sid = crypto.randomUUID()
      localStorage.setItem('mob-session-id', sid)
    }
    setSessionId(sid)

    const savedBaseUrl = localStorage.getItem('api-base-url')
    const savedApiKey = localStorage.getItem('api-key')
    const savedModel = localStorage.getItem('api-model')
    const savedProvider = localStorage.getItem('api-provider')

    setSettings({
      baseUrl: savedBaseUrl || '',
      apiKey: savedApiKey || '',
      model: savedModel || '',
      provider: savedProvider || ''
    })

    // Check if API key is configured
    if (!savedApiKey) {
      setIsSettingsOpen(true)
    } else {
      loadHistory(sid)
      loadSessions()
    }
  }, [])

  const loadSessions = async () => {
    try {
      console.log('Loading sessions...')
      const response = await fetch('/api/sessions')
      console.log('Sessions response status:', response.status)
      if (response.ok) {
        const data = await response.json() as { sessions: Session[] }
        console.log('Sessions loaded:', data.sessions)
        setSessions(data.sessions)
      } else {
        console.error('Failed to load sessions, status:', response.status)
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
            // User messages are stored as AgentMessage objects with content array
            if (Array.isArray(msg.content)) {
              const text = msg.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('')
              if (text) {
                historyMessages.push({ role: 'user', content: text })
              }
            } else if (typeof msg.content === 'string') {
              // Fallback for legacy messages
              historyMessages.push({ role: 'user', content: msg.content })
            }
          } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            const text = msg.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('')
            if (text) {
              historyMessages.push({ role: 'assistant', content: text })
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

    // Add new session to the list immediately (optimistic update)
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
        // If deleting current session, create a new one
        if (sid === sessionId) {
          createNewSession()
        } else {
          // Just reload the sessions list
          loadSessions()
        }
      } else {
        console.error('Failed to delete session')
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

  const handleSaveSettings = (baseUrl: string, apiKey: string, model: string, provider: string) => {
    localStorage.setItem('api-base-url', baseUrl)
    localStorage.setItem('api-key', apiKey)
    localStorage.setItem('api-model', model)
    localStorage.setItem('api-provider', provider)
    setSettings({ baseUrl, apiKey, model, provider })

    if (apiKey) {
      if (messages.length === 0) {
        loadHistory(sessionId)
      }
      loadSessions()
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!settings.apiKey) {
      setIsSettingsOpen(true)
      return
    }

    const message = inputValue.trim()
    if (!message) return

    // Add user message
    setMessages([...messages, { role: 'user', content: message }])
    setInputValue('')
    setIsLoading(true)

    // Add loading indicator
    const loadingMessage: Message = { role: 'assistant', content: '...' }
    setMessages(prev => [...prev, loadingMessage])

    try {
      const response = await fetch(`/api/session/${sessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          model: settings.model,
          provider: settings.provider
        }),
      })

      if (!response.ok) throw new Error('Request failed')

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let assistantMessage = ''

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
                // Update last message (remove loading, update with real content)
                setMessages(prev => {
                  const newMessages = [...prev]
                  newMessages[newMessages.length - 1] = {
                    role: 'assistant',
                    content: assistantMessage
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
      // Focus back to input after conversation ends
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
            <h1>🤖 Mob Chat</h1>
          </div>
          <button className="settings-btn" onClick={() => setIsSettingsOpen(true)}>
            ⚙️ Settings
          </button>
        </header>

        <div id="messages">
          {messages.map((msg, idx) => (
            <ChatMessage key={idx} role={msg.role} content={msg.content} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form id="input-form" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            id="message-input"
            placeholder="Type your message..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading}>Send</button>
        </form>
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
        initialBaseUrl={settings.baseUrl}
        initialApiKey={settings.apiKey}
        initialModel={settings.model}
        initialProvider={settings.provider}
      />
    </div>
  )
}
