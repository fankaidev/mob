import { atom } from 'jotai'
import type { createStore } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { hc, type InferResponseType } from 'hono/client'
import type { FileExplorerApi } from '@backend/api/stores/FileExplorerStore'
import { apiFetch } from 'txom-frontend-libs'

type Store = ReturnType<typeof createStore>
const api = hc<FileExplorerApi>('/api/FileExplorerStore', { fetch: apiFetch })

export type DirItem = InferResponseType<typeof api.refresh.$get, 200>['items'][number]

// Current path being viewed
export const currentPathAtom = atom('/')

// Directory listing query
export const refreshAtom = atomWithQuery((get) => {
  const path = get(currentPathAtom)
  return {
    queryKey: ['FileExplorerStore', 'dir', path],
    queryFn: async () => {
      const res = await api.refresh.$get({ query: { path } })
      return await res.json()
    },
  }
})

// Selected file/folder for actions
export const selectedItemAtom = atom<DirItem | null>(null)

// File content viewer state
export const fileContentAtom = atom<{ path: string; content: string; size: number; mtime: number } | null>(null)

// Editor draft content (what user is typing)
export const editorDraftAtom = atom<string | null>(null)

// Whether the editor has unsaved changes
export const editorDirtyAtom = atom((get) => {
  const draft = get(editorDraftAtom)
  const file = get(fileContentAtom)
  if (draft === null || !file) return false
  return draft !== file.content
})

// Saving state
export const editorSavingAtom = atom(false)

// Loading state for file content
export const fileContentLoadingAtom = atom(false)

// Navigate to a directory
export const navigateToPathAtom = atom(null, (get, set, path: string) => {
  set(currentPathAtom, path)
  set(selectedItemAtom, null)
  set(fileContentAtom, null)
  set(editorDraftAtom, null)
})

// Navigate into a subdirectory (relative)
export const enterDirectoryAtom = atom(null, (get, set, name: string) => {
  const current = get(currentPathAtom)
  const newPath = current === '/' ? `/${name}` : `${current}/${name}`
  set(currentPathAtom, newPath)
  set(selectedItemAtom, null)
  set(fileContentAtom, null)
  set(editorDraftAtom, null)
})

// Navigate up one level
export const goUpAtom = atom(null, (get, set) => {
  const current = get(currentPathAtom)
  if (current === '/') return
  const parts = current.split('/').filter(Boolean)
  parts.pop()
  const newPath = parts.length === 0 ? '/' : `/${parts.join('/')}`
  set(currentPathAtom, newPath)
  set(selectedItemAtom, null)
  set(fileContentAtom, null)
  set(editorDraftAtom, null)
})

// Read file content
export const readFileAtom = atom(null, async (get, set, path: string) => {
  set(fileContentLoadingAtom, true)
  set(editorDraftAtom, null)
  try {
    const res = await api['read-file'].$get({ query: { path } })
    const data = await res.json()
    set(fileContentAtom, data)
    set(editorDraftAtom, data.content)
  } finally {
    set(fileContentLoadingAtom, false)
  }
})

// Update editor draft content
export const updateDraftAtom = atom(null, (get, set, content: string) => {
  set(editorDraftAtom, content)
})

// Save edited file content
export const saveFileAtom = atom(null, async (get, set) => {
  const file = get(fileContentAtom)
  const draft = get(editorDraftAtom)
  if (!file || draft === null) return
  set(editorSavingAtom, true)
  try {
    const res = await api['write-file'].$post({ json: { path: file.path, content: draft } })
    const result = await res.json()
    // Update local state with server-confirmed size
    set(fileContentAtom, { ...file, content: draft, size: result.size })
    // Refresh directory listing to update file sizes
    await get(refreshAtom).refetch()
  } finally {
    set(editorSavingAtom, false)
  }
})

// Create new file
export const createFileAtom = atom(null, async (get, set, params: { name: string; content: string }) => {
  const currentPath = get(currentPathAtom)
  const filePath = currentPath === '/' ? `/${params.name}` : `${currentPath}/${params.name}`
  await api['write-file'].$post({ json: { path: filePath, content: params.content } })
  await get(refreshAtom).refetch()
})

// Create new directory
export const createDirAtom = atom(null, async (get, set, name: string) => {
  const currentPath = get(currentPathAtom)
  const dirPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`
  await api.mkdir.$post({ json: { path: dirPath } })
  await get(refreshAtom).refetch()
})

// Delete file or directory
export const deleteItemAtom = atom(null, async (get, set, path: string) => {
  await api.delete.$post({ json: { path } })
  set(selectedItemAtom, null)
  set(fileContentAtom, null)
  set(editorDraftAtom, null)
  await get(refreshAtom).refetch()
})

// Rename file or directory
export const renameItemAtom = atom(null, async (get, set, params: { oldPath: string; newName: string }) => {
  const currentPath = get(currentPathAtom)
  const parentPath = currentPath
  const newPath = parentPath === '/' ? `/${params.newName}` : `${parentPath}/${params.newName}`
  await api.rename.$post({ json: { oldPath: params.oldPath, newPath } })
  set(selectedItemAtom, null)
  await get(refreshAtom).refetch()
})

// Dialog state
export type DialogType = 'createFile' | 'createDir' | 'rename' | 'delete' | null
export const activeDialogAtom = atom<DialogType>(null)

// Breadcrumb segments derived from current path
export const breadcrumbsAtom = atom((get) => {
  const path = get(currentPathAtom)
  if (path === '/') return [{ name: '/', path: '/' }]
  const parts = path.split('/').filter(Boolean)
  const segments = [{ name: '/', path: '/' }]
  let accumulated = ''
  for (const part of parts) {
    accumulated += `/${part}`
    segments.push({ name: part, path: accumulated })
  }
  return segments
})

// Route loader
export function loader(store: Store) {
  store.set(currentPathAtom, '/')
  store.set(selectedItemAtom, null)
  store.set(fileContentAtom, null)
  store.set(editorDraftAtom, null)
  store.get(refreshAtom)
  return null
}
