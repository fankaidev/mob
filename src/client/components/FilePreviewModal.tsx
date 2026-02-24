import { useEffect, useState } from 'react'

interface FilePreviewModalProps {
  path: string
  sessionId: string
  onClose: () => void
}

export function FilePreviewModal({ path, sessionId, onClose }: FilePreviewModalProps) {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadFileContent()
  }, [path, sessionId])

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const loadFileContent = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/files/content?path=${encodeURIComponent(path)}&sessionId=${encodeURIComponent(sessionId)}`)
      if (!response.ok) {
        throw new Error('Failed to load file content')
      }
      const data = await response.json()
      setContent(data.content || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#d9d9e3]">
          <h2 className="text-lg font-semibold text-[#353740] truncate">
            {path}
          </h2>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center hover:bg-[#ececf1] rounded-md transition-colors flex-shrink-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full text-[#6b7280]">
              Loading...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-red-500">
              {error}
            </div>
          ) : (
            <pre className="text-sm text-[#353740] whitespace-pre-wrap break-words font-mono">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
