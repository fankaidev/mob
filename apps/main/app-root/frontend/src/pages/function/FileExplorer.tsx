import { useState, useRef, useEffect } from 'react'
import { useAtomValue, useSetAtom, useAtom } from 'jotai'
import * as Store from '../../stores/FileExplorerStore'
import type { DirItem } from '../../stores/FileExplorerStore'

// ============================================================================
// Icons (inline SVG for simplicity)
// ============================================================================

function FolderIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6.5l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  )
}

function FileIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function ArrowUpIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

// ============================================================================
// Utility
// ============================================================================

function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function formatTime(epoch: number): string {
  if (!epoch) return '—'
  return new Date(epoch * 1000).toLocaleString()
}

function getFileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

// ============================================================================
// Breadcrumb
// ============================================================================

function Breadcrumb() {
  const breadcrumbs = useAtomValue(Store.breadcrumbsAtom)
  const navigate = useSetAtom(Store.navigateToPathAtom)

  return (
    <div className="flex items-center gap-1 text-sm px-1">
      {breadcrumbs.map((seg, i) => (
        <span key={seg.path} className="flex items-center gap-1">
          {i > 0 && <ChevronRightIcon />}
          <button
            onClick={() => navigate(seg.path)}
            className={`px-1.5 py-0.5 rounded transition-colors ${
              i === breadcrumbs.length - 1
                ? 'text-[#e2e8f0] font-medium'
                : 'text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1e293b]'
            }`}
          >
            {seg.name === '/' ? 'root' : seg.name}
          </button>
        </span>
      ))}
    </div>
  )
}

// ============================================================================
// Toolbar
// ============================================================================

function Toolbar() {
  const goUp = useSetAtom(Store.goUpAtom)
  const currentPath = useAtomValue(Store.currentPathAtom)
  const [, setDialog] = useAtom(Store.activeDialogAtom)
  const selected = useAtomValue(Store.selectedItemAtom)

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-[#1e293b]">
      <button
        onClick={() => goUp()}
        disabled={currentPath === '/'}
        className="p-1.5 rounded text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1e293b] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Go up"
      >
        <ArrowUpIcon />
      </button>
      <Breadcrumb />
      <div className="flex-1" />
      <button
        onClick={() => setDialog('createFile')}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1e293b] transition-colors"
      >
        <PlusIcon /> File
      </button>
      <button
        onClick={() => setDialog('createDir')}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1e293b] transition-colors"
      >
        <PlusIcon /> Folder
      </button>
      {selected && (
        <>
          <button
            onClick={() => setDialog('rename')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1e293b] transition-colors"
          >
            <EditIcon /> Rename
          </button>
          <button
            onClick={() => setDialog('delete')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#ef4444] hover:text-white hover:bg-[#7f1d1d] transition-colors"
          >
            <TrashIcon /> Delete
          </button>
        </>
      )}
    </div>
  )
}

// ============================================================================
// File List
// ============================================================================

function FileListItem({ item }: { item: DirItem }) {
  const [selected, setSelected] = useAtom(Store.selectedItemAtom)
  const enterDir = useSetAtom(Store.enterDirectoryAtom)
  const readFile = useSetAtom(Store.readFileAtom)
  const currentPath = useAtomValue(Store.currentPathAtom)
  const isSelected = selected?.ino === item.ino

  const fullPath = currentPath === '/' ? `/${item.name}` : `${currentPath}/${item.name}`

  const handleClick = () => {
    setSelected(item)
    if (item.isFile) {
      readFile(fullPath)
    }
  }

  const handleDoubleClick = () => {
    if (item.isDirectory) {
      enterDir(item.name)
    }
  }

  const ext = getFileExtension(item.name)

  return (
    <tr
      className={`cursor-pointer transition-colors ${
        isSelected
          ? 'bg-[#1e293b]'
          : 'hover:bg-[#0f172a]'
      }`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <td className="px-4 py-2.5 flex items-center gap-3">
        {item.isDirectory ? (
          <FolderIcon className="w-5 h-5 text-[#818cf8] flex-shrink-0" />
        ) : (
          <FileIcon className="w-5 h-5 text-[#64748b] flex-shrink-0" />
        )}
        <span className={`text-sm ${item.isDirectory ? 'text-[#e2e8f0] font-medium' : 'text-[#cbd5e1]'}`}>
          {item.name}
        </span>
        {ext && !item.isDirectory && (
          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-[#1e293b] text-[#64748b] font-mono">
            {ext}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-xs text-[#64748b] text-right font-mono">
        {item.isDirectory ? '—' : formatSize(item.size)}
      </td>
      <td className="px-4 py-2.5 text-xs text-[#64748b] text-right">
        {formatTime(item.mtime)}
      </td>
    </tr>
  )
}

function FileList() {
  const { data, isPending, isError } = useAtomValue(Store.refreshAtom)

  if (isPending) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#818cf8] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-[#64748b]">Loading...</span>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm text-[#ef4444]">Failed to load directory</span>
      </div>
    )
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-[#475569]">
          <FolderIcon className="w-12 h-12" />
          <span className="text-sm">Empty directory</span>
        </div>
      </div>
    )
  }

  // Sort: directories first, then files, alphabetically within each group
  const sorted = [...data.items].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full">
        <thead>
          <tr className="text-xs text-[#475569] uppercase tracking-wider border-b border-[#1e293b]">
            <th className="px-4 py-2 text-left font-medium">Name</th>
            <th className="px-4 py-2 text-right font-medium w-28">Size</th>
            <th className="px-4 py-2 text-right font-medium w-44">Modified</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(item => (
            <FileListItem key={item.ino} item={item} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ============================================================================
// File Editor Panel
// ============================================================================

function SaveIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  )
}

function FileContentPanel() {
  const fileContent = useAtomValue(Store.fileContentAtom)
  const loading = useAtomValue(Store.fileContentLoadingAtom)
  const selected = useAtomValue(Store.selectedItemAtom)
  const draft = useAtomValue(Store.editorDraftAtom)
  const isDirty = useAtomValue(Store.editorDirtyAtom)
  const isSaving = useAtomValue(Store.editorSavingAtom)
  const updateDraft = useSetAtom(Store.updateDraftAtom)
  const saveFile = useSetAtom(Store.saveFileAtom)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Keyboard shortcut: Ctrl+S / Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (isDirty && !isSaving) saveFile()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isDirty, isSaving, saveFile])

  if (!selected) {
    return (
      <div className="flex items-center justify-center h-full text-[#475569] text-sm">
        Select a file to preview and edit
      </div>
    )
  }

  if (selected.isDirectory) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-[#475569]">
        <FolderIcon className="w-10 h-10" />
        <span className="text-sm font-medium text-[#94a3b8]">{selected.name}</span>
        <span className="text-xs">Directory</span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[#818cf8] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!fileContent || draft === null) {
    return (
      <div className="flex items-center justify-center h-full text-[#475569] text-sm">
        Loading...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Editor header */}
      <div className="px-4 py-2 border-b border-[#1e293b] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-[#e2e8f0] truncate">{selected.name}</span>
          {isDirty && (
            <span className="w-2 h-2 rounded-full bg-[#f59e0b] flex-shrink-0" title="Unsaved changes" />
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-[#64748b] font-mono">{formatSize(new TextEncoder().encode(draft).length)}</span>
          <button
            onClick={() => saveFile()}
            disabled={!isDirty || isSaving}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              isDirty && !isSaving
                ? 'bg-[#818cf8] text-white hover:bg-[#6366f1]'
                : 'bg-[#1e293b] text-[#475569] cursor-not-allowed'
            }`}
          >
            <SaveIcon />
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      {/* Editor textarea */}
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={e => updateDraft(e.target.value)}
        className="flex-1 w-full p-4 bg-transparent text-sm text-[#cbd5e1] font-mono leading-relaxed resize-none outline-none"
        spellCheck={false}
      />
    </div>
  )
}

// ============================================================================
// Status Bar
// ============================================================================

function StatusBar() {
  const { data } = useAtomValue(Store.refreshAtom)
  const currentPath = useAtomValue(Store.currentPathAtom)

  const itemCount = data?.items.length ?? 0
  const dirCount = data?.items.filter(i => i.isDirectory).length ?? 0
  const fileCount = itemCount - dirCount

  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-t border-[#1e293b] text-xs text-[#475569]">
      <div className="flex items-center gap-4">
        <span>{itemCount} items ({dirCount} folders, {fileCount} files)</span>
        {data?.stats && (
          <span>Total: {data.stats.totalInodes} inodes, {formatSize(data.stats.totalBytes)}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[#818cf8]">PostgreSQL</span>
        <span>AgentFS v0.4</span>
      </div>
    </div>
  )
}

// ============================================================================
// Dialogs
// ============================================================================

function CreateDialog({ type }: { type: 'createFile' | 'createDir' }) {
  const [, setDialog] = useAtom(Store.activeDialogAtom)
  const createFile = useSetAtom(Store.createFileAtom)
  const createDir = useSetAtom(Store.createDirAtom)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    if (type === 'createFile') {
      await createFile({ name: name.trim(), content })
    } else {
      await createDir(name.trim())
    }
    setDialog(null)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setDialog(null)}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()} className="bg-[#0f172a] border border-[#1e293b] rounded-lg p-6 w-96 shadow-2xl">
        <h3 className="text-sm font-semibold text-[#e2e8f0] mb-4">
          {type === 'createFile' ? 'Create New File' : 'Create New Folder'}
        </h3>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={type === 'createFile' ? 'filename.txt' : 'folder-name'}
          className="w-full px-3 py-2 bg-[#1e293b] border border-[#334155] rounded text-sm text-[#e2e8f0] placeholder:text-[#475569] outline-none focus:border-[#818cf8] mb-3"
          required
        />
        {type === 'createFile' && (
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="File content (optional)"
            rows={6}
            className="w-full px-3 py-2 bg-[#1e293b] border border-[#334155] rounded text-sm text-[#e2e8f0] placeholder:text-[#475569] outline-none focus:border-[#818cf8] mb-3 font-mono resize-none"
          />
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setDialog(null)} className="px-4 py-2 rounded text-sm text-[#94a3b8] hover:bg-[#1e293b] transition-colors">
            Cancel
          </button>
          <button type="submit" className="px-4 py-2 rounded text-sm bg-[#818cf8] text-white hover:bg-[#6366f1] transition-colors font-medium">
            Create
          </button>
        </div>
      </form>
    </div>
  )
}

function RenameDialog() {
  const [, setDialog] = useAtom(Store.activeDialogAtom)
  const selected = useAtomValue(Store.selectedItemAtom)
  const rename = useSetAtom(Store.renameItemAtom)
  const currentPath = useAtomValue(Store.currentPathAtom)
  const [name, setName] = useState(selected?.name ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  if (!selected) return null

  const fullPath = currentPath === '/' ? `/${selected.name}` : `${currentPath}/${selected.name}`

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || name.trim() === selected.name) return
    await rename({ oldPath: fullPath, newName: name.trim() })
    setDialog(null)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setDialog(null)}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()} className="bg-[#0f172a] border border-[#1e293b] rounded-lg p-6 w-96 shadow-2xl">
        <h3 className="text-sm font-semibold text-[#e2e8f0] mb-4">Rename</h3>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2 bg-[#1e293b] border border-[#334155] rounded text-sm text-[#e2e8f0] outline-none focus:border-[#818cf8] mb-3"
          required
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setDialog(null)} className="px-4 py-2 rounded text-sm text-[#94a3b8] hover:bg-[#1e293b] transition-colors">
            Cancel
          </button>
          <button type="submit" className="px-4 py-2 rounded text-sm bg-[#818cf8] text-white hover:bg-[#6366f1] transition-colors font-medium">
            Rename
          </button>
        </div>
      </form>
    </div>
  )
}

function DeleteDialog() {
  const [, setDialog] = useAtom(Store.activeDialogAtom)
  const selected = useAtomValue(Store.selectedItemAtom)
  const deleteItem = useSetAtom(Store.deleteItemAtom)
  const currentPath = useAtomValue(Store.currentPathAtom)

  if (!selected) return null

  const fullPath = currentPath === '/' ? `/${selected.name}` : `${currentPath}/${selected.name}`

  const handleDelete = async () => {
    await deleteItem(fullPath)
    setDialog(null)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setDialog(null)}>
      <div onClick={e => e.stopPropagation()} className="bg-[#0f172a] border border-[#1e293b] rounded-lg p-6 w-96 shadow-2xl">
        <h3 className="text-sm font-semibold text-[#e2e8f0] mb-2">Delete {selected.isDirectory ? 'Folder' : 'File'}</h3>
        <p className="text-sm text-[#94a3b8] mb-4">
          Are you sure you want to delete <span className="font-mono text-[#e2e8f0]">{selected.name}</span>?
          {selected.isDirectory && ' The folder must be empty.'}
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={() => setDialog(null)} className="px-4 py-2 rounded text-sm text-[#94a3b8] hover:bg-[#1e293b] transition-colors">
            Cancel
          </button>
          <button onClick={handleDelete} className="px-4 py-2 rounded text-sm bg-[#ef4444] text-white hover:bg-[#dc2626] transition-colors font-medium">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function DialogManager() {
  const dialog = useAtomValue(Store.activeDialogAtom)
  if (!dialog) return null
  if (dialog === 'createFile') return <CreateDialog type="createFile" />
  if (dialog === 'createDir') return <CreateDialog type="createDir" />
  if (dialog === 'rename') return <RenameDialog />
  if (dialog === 'delete') return <DeleteDialog />
  return null
}

// ============================================================================
// Main Layout
// ============================================================================

export default function FileExplorer() {
  return (
    <div className="h-screen flex flex-col bg-[#020617] text-[#e2e8f0]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1e293b]">
        <div className="w-8 h-8 rounded-lg bg-[#818cf8] flex items-center justify-center">
          <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
        </div>
        <div>
          <h1 className="text-sm font-semibold">AgentFS Explorer</h1>
          <p className="text-xs text-[#475569]">PostgreSQL-backed virtual filesystem</p>
        </div>
      </div>

      {/* Toolbar */}
      <Toolbar />

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* File List (left panel) */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-[#1e293b]">
          <FileList />
        </div>

        {/* Preview Panel (right panel) */}
        <div className="w-[420px] flex-shrink-0 flex flex-col">
          <FileContentPanel />
        </div>
      </div>

      {/* Status Bar */}
      <StatusBar />

      {/* Dialogs */}
      <DialogManager />
    </div>
  )
}
