import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  messagesAtom,
  isStreamingAtom,
  streamMessageAtom,
  errorAtom,
  sendMessageAtom,
  abortAtom,
  clearChatAtom,
  artifactsAtom,
  showArtifactsPanelAtom,
  showSessionsPanelAtom,
} from '../../stores/ChatStore'
import type { AgentMessage } from '../../lib/pi-agent/src/index'
import type { AssistantMessage, ToolResultMessage } from '../../lib/pi-ai/src/index'
import { Send, Square, Trash2, PanelRightOpen, PanelRightClose, PanelLeftOpen, PanelLeftClose, ChevronDown, FolderOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { pageLinks } from '../../pageLinks'
import { ArtifactPanel } from './ChatArtifacts'
import { SessionPanel } from './ChatSessions'

// ============================================================================
// Message Components
// ============================================================================

function UserMessageBubble({ message }: { message: AgentMessage }) {
  if (message.role !== 'user') return null
  const content = Array.isArray(message.content)
    ? message.content.filter((c) => c.type === 'text').map((c) => (c as any).text).join('\n')
    : ''
  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[#2563eb] text-white px-4 py-2.5 text-sm leading-relaxed">
        <div className="whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  )
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!thinking.trim()) return null
  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-[#8b8fa3] hover:text-[#c0c4d6] transition-colors"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? '' : '-rotate-90'}`} />
        Thinking...
      </button>
      {expanded && (
        <div className="mt-1 pl-4 border-l-2 border-[#2a2d3a] text-xs text-[#6b7080] whitespace-pre-wrap leading-relaxed">
          {thinking}
        </div>
      )}
    </div>
  )
}

function ToolCallBlock({ toolCall }: { toolCall: any }) {
  const [expanded, setExpanded] = useState(false)
  const argsStr = typeof toolCall.arguments === 'string'
    ? toolCall.arguments
    : JSON.stringify(toolCall.arguments, null, 2)

  return (
    <div className="my-2 rounded-lg border border-[#2a2d3a] bg-[#1a1c27] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#8b8fa3] hover:bg-[#22253a] transition-colors"
      >
        <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#2a2d3a] text-[#60a5fa] text-[10px] font-bold">⚡</span>
        <span className="font-medium text-[#c0c4d6]">{toolCall.name}</span>
        <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </button>
      {expanded && (
        <pre className="px-3 py-2 text-xs text-[#8b8fa3] border-t border-[#2a2d3a] overflow-x-auto">
          {argsStr}
        </pre>
      )}
    </div>
  )
}

function ToolResultBlock({ message }: { message: ToolResultMessage }) {
  const [expanded, setExpanded] = useState(false)
  const output = message.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as any).text)
    .join('\n')

  if (!output.trim()) return null

  const truncated = output.length > 200 ? output.slice(0, 200) + '...' : output
  const needsExpand = output.length > 200

  return (
    <div className="my-2 rounded-lg bg-[#1a1c27] border border-[#2a2d3a] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-[#8b8fa3]">
        <span className={`w-1.5 h-1.5 rounded-full ${message.isError ? 'bg-red-500' : 'bg-emerald-500'}`} />
        <span className="font-medium">{message.toolName} result</span>
        {needsExpand && (
          <button onClick={() => setExpanded(!expanded)} className="ml-auto text-[10px] text-[#60a5fa] hover:underline">
            {expanded ? 'collapse' : 'expand'}
          </button>
        )}
      </div>
      <pre className="px-3 py-2 text-xs text-[#8b8fa3] border-t border-[#2a2d3a] overflow-x-auto whitespace-pre-wrap">
        {expanded ? output : truncated}
      </pre>
    </div>
  )
}

function AssistantMessageBubble({ message, isStreaming }: { message: AssistantMessage; isStreaming?: boolean }) {
  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[85%]">
        {message.content.map((block, i) => {
          if (block.type === 'thinking') {
            return <ThinkingBlock key={i} thinking={block.thinking} />
          }
          if (block.type === 'text' && block.text.trim()) {
            return (
              <div key={i} className="prose prose-invert prose-sm max-w-none text-[#e1e4f0] leading-relaxed [&_pre]:bg-[#1a1c27] [&_pre]:border [&_pre]:border-[#2a2d3a] [&_pre]:rounded-lg [&_code]:text-[#60a5fa] [&_a]:text-[#60a5fa]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
              </div>
            )
          }
          if (block.type === 'toolCall') {
            return <ToolCallBlock key={i} toolCall={block} />
          }
          return null
        })}
        {isStreaming && (
          <span className="inline-block w-2 h-4 bg-[#60a5fa] animate-pulse rounded-sm ml-0.5" />
        )}
        {message.errorMessage && (
          <div className="mt-2 text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
            {message.errorMessage}
          </div>
        )}
      </div>
    </div>
  )
}

function MessageRenderer({ message }: { message: AgentMessage }) {
  if (message.role === 'user') {
    return <UserMessageBubble message={message} />
  }
  if (message.role === 'assistant') {
    return <AssistantMessageBubble message={message as AssistantMessage} />
  }
  if (message.role === 'toolResult') {
    return <ToolResultBlock message={message as ToolResultMessage} />
  }
  return null
}

// ============================================================================
// Message List
// ============================================================================

function MessageList() {
  const messages = useAtomValue(messagesAtom)
  const streamMessage = useAtomValue(streamMessageAtom)
  const isStreaming = useAtomValue(isStreamingAtom)
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const threshold = 100
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !autoScrollRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages, streamMessage])

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth"
    >
      {messages.length === 0 && !streamMessage && (
        <div className="flex flex-col items-center justify-center h-full text-[#4a4e60] select-none">
          <div className="text-5xl mb-4">π</div>
          <div className="text-lg font-medium mb-1">Pi Agent</div>
          <div className="text-sm">Ask me anything. I can run code, create files, and build things.</div>
        </div>
      )}
      {messages.map((msg, i) => (
        <MessageRenderer key={i} message={msg} />
      ))}
      {streamMessage && streamMessage.role === 'assistant' && (
        <AssistantMessageBubble message={streamMessage as AssistantMessage} isStreaming />
      )}
    </div>
  )
}

// ============================================================================
// Input Bar
// ============================================================================

function ChatInput() {
  const [input, setInput] = useState('')
  const isStreaming = useAtomValue(isStreamingAtom)
  const sendMessage = useSetAtom(sendMessageAtom)
  const abort = useSetAtom(abortAtom)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    sendMessage(trimmed)
    setInput('')
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, isStreaming, sendMessage])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  // Auto-resize textarea
  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  return (
    <div className="border-t border-[#2a2d3a] bg-[#13141f] px-4 py-3">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          rows={1}
          className="flex-1 resize-none rounded-xl bg-[#1e2033] border border-[#2a2d3a] px-4 py-2.5 text-sm text-[#e1e4f0] placeholder-[#4a4e60] focus:outline-none focus:border-[#3b4070] transition-colors"
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button
            onClick={() => abort()}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
            title="Stop generation"
          >
            <Square className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#2563eb] text-white hover:bg-[#3b82f6] disabled:opacity-30 disabled:hover:bg-[#2563eb] transition-colors"
            title="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Header
// ============================================================================

function ChatHeader() {
  const clearChat = useSetAtom(clearChatAtom)
  const artifacts = useAtomValue(artifactsAtom)
  const showArtifacts = useAtomValue(showArtifactsPanelAtom)
  const setShowArtifacts = useSetAtom(showArtifactsPanelAtom)
  const showSessions = useAtomValue(showSessionsPanelAtom)
  const setShowSessions = useSetAtom(showSessionsPanelAtom)
  const isStreaming = useAtomValue(isStreamingAtom)

  return (
    <div className="flex items-center justify-between border-b border-[#2a2d3a] bg-[#13141f] px-4 py-2.5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowSessions(!showSessions)}
          className="p-1.5 rounded-lg text-[#8b8fa3] hover:text-[#c0c4d6] hover:bg-[#1e2033] transition-colors"
          title={showSessions ? 'Hide history' : 'Show history'}
        >
          {showSessions ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
        </button>
        <span className="text-lg font-semibold text-[#e1e4f0]">π</span>
        <span className="text-sm font-medium text-[#c0c4d6]">Pi Agent</span>
      </div>
      <div className="flex items-center gap-1">
        <Link
          to={pageLinks.FileExplorer()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[#8b8fa3] hover:text-[#60a5fa] hover:bg-[#1e2033] transition-colors"
          title="File Explorer"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>Files</span>
        </Link>
        {artifacts.size > 0 && (
          <button
            onClick={() => setShowArtifacts(!showArtifacts)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[#8b8fa3] hover:text-[#c0c4d6] hover:bg-[#1e2033] transition-colors"
            title={showArtifacts ? 'Hide artifacts' : 'Show artifacts'}
          >
            {showArtifacts ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
            <span className="tabular-nums">{artifacts.size}</span>
          </button>
        )}
        <button
          onClick={() => clearChat()}
          disabled={isStreaming}
          className="p-2 rounded-lg text-[#8b8fa3] hover:text-[#c0c4d6] hover:bg-[#1e2033] disabled:opacity-30 transition-colors"
          title="Clear chat"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Main Page
// ============================================================================

export default function ChatPage() {
  const showArtifacts = useAtomValue(showArtifactsPanelAtom)
  const showSessions = useAtomValue(showSessionsPanelAtom)
  const error = useAtomValue(errorAtom)

  return (
    <div className="h-screen flex bg-[#0f1019] text-[#e1e4f0]">
      {/* Sessions Panel */}
      {showSessions && (
        <div className="w-72 flex-shrink-0 border-r border-[#2a2d3a]">
          <SessionPanel />
        </div>
      )}

      {/* Chat Panel */}
      <div className={`flex flex-col flex-1 min-w-0 ${showArtifacts ? 'max-w-[50%]' : ''}`}>
        <ChatHeader />
        {error && (
          <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}
        <MessageList />
        <ChatInput />
      </div>

      {/* Artifacts Panel */}
      {showArtifacts && (
        <div className="w-[50%] border-l border-[#2a2d3a]">
          <ArtifactPanel />
        </div>
      )}
    </div>
  )
}
