import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { X, Copy, Download, Code, Eye, RotateCw } from 'lucide-react'
import {
  artifactsAtom,
  activeArtifactAtom,
  showArtifactsPanelAtom,
} from '../../stores/ChatStore'
import type { Artifact } from '../../lib/agent/tools'

// ============================================================================
// Artifact Renderers
// ============================================================================

function HtmlArtifactView({ artifact }: { artifact: Artifact }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')

  const reloadIframe = useCallback(() => {
    const iframe = iframeRef.current
    if (iframe) {
      iframe.srcdoc = artifact.content
    }
  }, [artifact.content])

  if (viewMode === 'code') {
    return (
      <div className="h-full flex flex-col">
        <ArtifactViewHeader
          filename={artifact.filename}
          viewMode={viewMode}
          onToggleView={() => setViewMode('preview')}
          onReload={reloadIframe}
          content={artifact.content}
        />
        <pre className="flex-1 overflow-auto p-4 text-xs text-[#c0c4d6] bg-[#0f1019] font-mono leading-relaxed">
          {artifact.content}
        </pre>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <ArtifactViewHeader
        filename={artifact.filename}
        viewMode={viewMode}
        onToggleView={() => setViewMode('code')}
        onReload={reloadIframe}
        content={artifact.content}
      />
      <iframe
        ref={iframeRef}
        srcDoc={artifact.content}
        sandbox="allow-scripts allow-same-origin"
        className="flex-1 w-full bg-white rounded-b-lg"
        title={artifact.filename}
      />
    </div>
  )
}

function SvgArtifactView({ artifact }: { artifact: Artifact }) {
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')

  if (viewMode === 'code') {
    return (
      <div className="h-full flex flex-col">
        <ArtifactViewHeader
          filename={artifact.filename}
          viewMode={viewMode}
          onToggleView={() => setViewMode('preview')}
          content={artifact.content}
        />
        <pre className="flex-1 overflow-auto p-4 text-xs text-[#c0c4d6] bg-[#0f1019] font-mono leading-relaxed">
          {artifact.content}
        </pre>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <ArtifactViewHeader
        filename={artifact.filename}
        viewMode={viewMode}
        onToggleView={() => setViewMode('code')}
        content={artifact.content}
      />
      <div
        className="flex-1 overflow-auto flex items-center justify-center p-4 bg-[#0f1019]"
        dangerouslySetInnerHTML={{ __html: artifact.content }}
      />
    </div>
  )
}

function MarkdownArtifactView({ artifact }: { artifact: Artifact }) {
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')

  if (viewMode === 'code') {
    return (
      <div className="h-full flex flex-col">
        <ArtifactViewHeader
          filename={artifact.filename}
          viewMode={viewMode}
          onToggleView={() => setViewMode('preview')}
          content={artifact.content}
        />
        <pre className="flex-1 overflow-auto p-4 text-xs text-[#c0c4d6] bg-[#0f1019] font-mono leading-relaxed">
          {artifact.content}
        </pre>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <ArtifactViewHeader
        filename={artifact.filename}
        viewMode={viewMode}
        onToggleView={() => setViewMode('code')}
        content={artifact.content}
      />
      <div className="flex-1 overflow-auto p-6 prose prose-invert prose-sm max-w-none [&_pre]:bg-[#1a1c27] [&_pre]:border [&_pre]:border-[#2a2d3a] [&_code]:text-[#60a5fa]">
        <ReactMarkdown>{artifact.content}</ReactMarkdown>
      </div>
    </div>
  )
}

function TextArtifactView({ artifact }: { artifact: Artifact }) {
  return (
    <div className="h-full flex flex-col">
      <ArtifactViewHeader filename={artifact.filename} content={artifact.content} />
      <pre className="flex-1 overflow-auto p-4 text-xs text-[#c0c4d6] bg-[#0f1019] font-mono leading-relaxed whitespace-pre-wrap">
        {artifact.content}
      </pre>
    </div>
  )
}

// ============================================================================
// Shared header for artifact views
// ============================================================================

function ArtifactViewHeader({
  filename,
  viewMode,
  onToggleView,
  onReload,
  content,
}: {
  filename: string
  viewMode?: 'preview' | 'code'
  onToggleView?: () => void
  onReload?: () => void
  content: string
}) {
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content)
  }, [content])

  const handleDownload = useCallback(() => {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }, [content, filename])

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#2a2d3a] bg-[#13141f]">
      {onToggleView && (
        <button
          onClick={onToggleView}
          className="p-1.5 rounded text-[#8b8fa3] hover:text-[#c0c4d6] hover:bg-[#22253a] transition-colors"
          title={viewMode === 'preview' ? 'View code' : 'View preview'}
        >
          {viewMode === 'preview' ? <Code className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      )}
      {onReload && (
        <button
          onClick={onReload}
          className="p-1.5 rounded text-[#8b8fa3] hover:text-[#c0c4d6] hover:bg-[#22253a] transition-colors"
          title="Reload"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="flex-1" />
      <button
        onClick={handleCopy}
        className="p-1.5 rounded text-[#8b8fa3] hover:text-[#c0c4d6] hover:bg-[#22253a] transition-colors"
        title="Copy"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={handleDownload}
        className="p-1.5 rounded text-[#8b8fa3] hover:text-[#c0c4d6] hover:bg-[#22253a] transition-colors"
        title="Download"
      >
        <Download className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ============================================================================
// File type detection
// ============================================================================

function getFileType(filename: string): 'html' | 'svg' | 'markdown' | 'text' {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'svg') return 'svg'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  return 'text'
}

function ArtifactRenderer({ artifact }: { artifact: Artifact }) {
  const type = getFileType(artifact.filename)
  switch (type) {
    case 'html':
      return <HtmlArtifactView artifact={artifact} />
    case 'svg':
      return <SvgArtifactView artifact={artifact} />
    case 'markdown':
      return <MarkdownArtifactView artifact={artifact} />
    default:
      return <TextArtifactView artifact={artifact} />
  }
}

// ============================================================================
// Artifact Panel
// ============================================================================

export function ArtifactPanel() {
  const artifacts = useAtomValue(artifactsAtom)
  const activeFilename = useAtomValue(activeArtifactAtom)
  const setActiveArtifact = useSetAtom(activeArtifactAtom)
  const setShowPanel = useSetAtom(showArtifactsPanelAtom)

  const artifactList = useMemo(() => Array.from(artifacts.values()), [artifacts])
  const activeArtifact = activeFilename ? artifacts.get(activeFilename) : undefined

  if (artifactList.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[#4a4e60] text-sm bg-[#0f1019]">
        No artifacts yet
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-[#0f1019]">
      {/* Tab bar */}
      <div className="flex items-center border-b border-[#2a2d3a] bg-[#13141f]">
        <div className="flex-1 flex overflow-x-auto">
          {artifactList.map((a) => {
            const isActive = a.filename === activeFilename
            return (
              <button
                key={a.filename}
                onClick={() => setActiveArtifact(a.filename)}
                className={`px-3 py-2 whitespace-nowrap text-xs font-mono border-b-2 transition-colors ${
                  isActive
                    ? 'border-[#2563eb] text-[#60a5fa]'
                    : 'border-transparent text-[#6b7080] hover:text-[#c0c4d6]'
                }`}
              >
                {a.filename}
              </button>
            )
          })}
        </div>
        <button
          onClick={() => setShowPanel(false)}
          className="p-2 text-[#8b8fa3] hover:text-[#c0c4d6] hover:bg-[#22253a] transition-colors"
          title="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Active artifact content */}
      <div className="flex-1 overflow-hidden">
        {activeArtifact ? (
          <ArtifactRenderer artifact={activeArtifact} />
        ) : (
          <div className="h-full flex items-center justify-center text-[#4a4e60] text-sm">
            Select an artifact
          </div>
        )}
      </div>
    </div>
  )
}
