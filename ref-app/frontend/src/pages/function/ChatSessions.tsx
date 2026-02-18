import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect } from 'react'
import { MessageSquarePlus, X, Loader2 } from 'lucide-react'
import {
  sessionsAtom,
  showSessionsPanelAtom,
  sessionsLoadingAtom,
  loadSessionsAtom,
  switchSessionAtom,
  newChatAtom,
  isStreamingAtom,
} from '../../stores/ChatStore'
import type { SessionSummary } from '../../stores/ChatStore'

// ============================================================================
// Session item
// ============================================================================

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHr = Math.floor(diffMs / 3_600_000)
  const diffDay = Math.floor(diffMs / 86_400_000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  return date.toLocaleDateString()
}

function statusColor(status: string): string {
  switch (status) {
    case 'running': return 'bg-blue-500'
    case 'completed': return 'bg-emerald-500'
    case 'error': return 'bg-red-500'
    default: return 'bg-[#4a4e60]'
  }
}

function SessionItem({ session, onSelect }: { session: SessionSummary; onSelect: () => void }) {
  const preview = session.message.length > 80 ? session.message.slice(0, 80) + '...' : session.message

  return (
    <button
      onClick={onSelect}
      className="w-full text-left px-3 py-2.5 hover:bg-[#1e2033] rounded-lg transition-colors group"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor(session.status)}`} />
        <span className="text-xs text-[#6b7080] truncate">{formatTime(session.createdAt)}</span>
      </div>
      <div className="text-sm text-[#c0c4d6] truncate leading-snug group-hover:text-[#e1e4f0]">
        {preview}
      </div>
    </button>
  )
}

// ============================================================================
// Session panel
// ============================================================================

export function SessionPanel() {
  const sessions = useAtomValue(sessionsAtom)
  const loading = useAtomValue(sessionsLoadingAtom)
  const isStreaming = useAtomValue(isStreamingAtom)
  const setShowPanel = useSetAtom(showSessionsPanelAtom)
  const loadSessions = useSetAtom(loadSessionsAtom)
  const switchSession = useSetAtom(switchSessionAtom)
  const newChat = useSetAtom(newChatAtom)

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const handleNewChat = useCallback(() => {
    if (isStreaming) return
    newChat()
  }, [isStreaming, newChat])

  const handleSelect = useCallback((id: string) => {
    if (isStreaming) return
    switchSession(id)
    setShowPanel(false)
  }, [isStreaming, switchSession, setShowPanel])

  return (
    <div className="h-full flex flex-col bg-[#0f1019]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#2a2d3a] bg-[#13141f] px-3 py-2.5">
        <span className="text-sm font-medium text-[#c0c4d6]">History</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewChat}
            disabled={isStreaming}
            className="p-1.5 rounded text-[#8b8fa3] hover:text-[#60a5fa] hover:bg-[#22253a] disabled:opacity-30 transition-colors"
            title="New chat"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowPanel(false)}
            className="p-1.5 rounded text-[#8b8fa3] hover:text-[#c0c4d6] hover:bg-[#22253a] transition-colors"
            title="Close panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {loading && sessions.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[#4a4e60]">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[#4a4e60] text-sm">
            No sessions yet
          </div>
        ) : (
          sessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              onSelect={() => handleSelect(s.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
