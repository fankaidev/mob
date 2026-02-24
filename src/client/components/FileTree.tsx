import { useEffect, useState } from 'react'
import { FilePreviewModal } from './FilePreviewModal'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FileNode[]
  isExpanded?: boolean
}

interface FileTreeProps {
  sessionId: string
}

export function FileTree({ sessionId }: FileTreeProps) {
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  useEffect(() => {
    loadFileTree()
  }, [sessionId]) // Reload when sessionId changes

  const loadFileTree = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/files/tree?sessionId=${encodeURIComponent(sessionId)}`)
      if (!response.ok) {
        throw new Error('Failed to load file tree')
      }
      const data = await response.json()
      setFileTree(data.tree || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file tree')
    } finally {
      setLoading(false)
    }
  }

  const toggleDirectory = (path: string) => {
    setFileTree((prevTree) => {
      const updateNode = (nodes: FileNode[]): FileNode[] => {
        return nodes.map((node) => {
          if (node.path === path && node.type === 'dir') {
            return { ...node, isExpanded: !node.isExpanded }
          }
          if (node.children) {
            return { ...node, children: updateNode(node.children) }
          }
          return node
        })
      }
      return updateNode(prevTree)
    })
  }

  const handlePreview = (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setPreviewPath(path)
  }

  const handleDelete = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation()

    if (!confirm(`Are you sure you want to delete ${path}?`)) {
      return
    }

    try {
      const response = await fetch(`/api/files?path=${encodeURIComponent(path)}&sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete file')
      }

      // Reload the file tree
      await loadFileTree()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete file')
    }
  }

  const renderNode = (node: FileNode, depth = 0) => {
    const isDir = node.type === 'dir'
    const isExpanded = node.isExpanded ?? false

    return (
      <div key={node.path}>
        <div
          className="group flex items-center gap-1 px-2 py-1 hover:bg-[#ececf1] rounded text-xs"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <div
            className="flex items-center gap-1 flex-1 min-w-0 cursor-pointer"
            onClick={(e) => isDir ? toggleDirectory(node.path) : handlePreview(node.path, e)}
          >
            {isDir && (
              <>
              <span className="text-[#6b7280] w-3">
                {isExpanded ? '▼' : '▶'}
              </span>
              <span className="text-[#353740] truncate">📁 {node.name}</span>
              </>
            )}
            {!isDir && <>
              <span className="w-3" />
              <span className="text-[#353740] truncate">📄 {node.name}</span>
            </>}
          </div>

          {!isDir && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => handleDelete(node.path, e)}
                className="h-5 w-5 flex items-center justify-center hover:bg-white rounded"
                title="Delete"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          )}
        </div>
        {isDir && isExpanded && node.children && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="px-2 py-4 text-center text-[#6b7280] text-xs">
        Loading files...
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-2 py-4 text-center text-red-500 text-xs">
        {error}
      </div>
    )
  }

  if (fileTree.length === 0) {
    return (
      <div className="px-2 py-4 text-center text-[#6b7280] text-xs">
        No files
      </div>
    )
  }

  return (
    <>
      <div className="overflow-y-auto">
        <div className="py-1">
          {fileTree.map((node) => renderNode(node))}
        </div>
      </div>

      {previewPath && (
        <FilePreviewModal
          path={previewPath}
          sessionId={sessionId}
          onClose={() => setPreviewPath(null)}
        />
      )}
    </>
  )
}
