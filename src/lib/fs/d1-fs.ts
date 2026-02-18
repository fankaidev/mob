/**
 * D1FileSystem - Implements IFileSystem using Cloudflare D1 for persistent storage.
 *
 * All file operations directly read/write to the D1 `files` table.
 * This provides persistence across sessions without sync logic.
 */

import type {
  IFileSystem,
  FsStat,
  FileContent,
  MkdirOptions,
  RmOptions,
  CpOptions,
  BufferEncoding,
} from 'just-bash'

type FileType = 'file' | 'dir' | 'symlink'

interface FileRow {
  id: number
  session_id: string
  path: string
  type: FileType
  content: string | null
  target: string | null
  mode: number
  mtime: number
}

export class D1FileSystem implements IFileSystem {
  private db: D1Database
  private sessionId: string

  constructor(db: D1Database, sessionId: string) {
    this.db = db
    this.sessionId = sessionId
  }

  // ============================================================================
  // Path utilities
  // ============================================================================

  private normalizePath(p: string): string {
    if (!p || p === '/') return '/'
    let n = p.endsWith('/') && p !== '/' ? p.slice(0, -1) : p
    if (!n.startsWith('/')) n = `/${n}`
    const parts = n.split('/').filter((s) => s && s !== '.')
    const resolved: string[] = []
    for (const part of parts) {
      if (part === '..') resolved.pop()
      else resolved.push(part)
    }
    return `/${resolved.join('/')}`
  }

  private getParentPath(path: string): string {
    const normalized = this.normalizePath(path)
    if (normalized === '/') return '/'
    const lastSlash = normalized.lastIndexOf('/')
    return lastSlash === 0 ? '/' : normalized.slice(0, lastSlash)
  }

  private getBaseName(path: string): string {
    const normalized = this.normalizePath(path)
    if (normalized === '/') return '/'
    return normalized.slice(normalized.lastIndexOf('/') + 1)
  }

  // ============================================================================
  // Database operations
  // ============================================================================

  private async getEntry(path: string): Promise<FileRow | null> {
    const normalized = this.normalizePath(path)
    const result = await this.db.prepare(
      'SELECT * FROM files WHERE session_id = ? AND path = ?'
    ).bind(this.sessionId, normalized).first()
    return result as FileRow | null
  }

  private async setEntry(
    path: string,
    type: FileType,
    content: string | null,
    target: string | null,
    mode: number
  ): Promise<void> {
    const normalized = this.normalizePath(path)
    const now = Date.now()
    await this.db.prepare(
      `INSERT OR REPLACE INTO files (session_id, path, type, content, target, mode, mtime)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(this.sessionId, normalized, type, content, target, mode, now).run()
  }

  private async deleteEntry(path: string): Promise<void> {
    const normalized = this.normalizePath(path)
    await this.db.prepare(
      'DELETE FROM files WHERE session_id = ? AND path = ?'
    ).bind(this.sessionId, normalized).run()
  }

  private async deleteEntriesWithPrefix(prefix: string): Promise<void> {
    const normalized = this.normalizePath(prefix)
    const pattern = normalized === '/' ? '/%' : `${normalized}/%`
    await this.db.prepare(
      'DELETE FROM files WHERE session_id = ? AND (path = ? OR path LIKE ?)'
    ).bind(this.sessionId, normalized, pattern).run()
  }

  // ============================================================================
  // Error helpers
  // ============================================================================

  private enoent(op: string, path: string): never {
    throw Object.assign(
      new Error(`ENOENT: no such file or directory, ${op} '${path}'`),
      { code: 'ENOENT' }
    )
  }

  private eexist(op: string, path: string): never {
    throw Object.assign(
      new Error(`EEXIST: file already exists, ${op} '${path}'`),
      { code: 'EEXIST' }
    )
  }

  private eisdir(op: string, path: string): never {
    throw Object.assign(
      new Error(`EISDIR: illegal operation on a directory, ${op} '${path}'`),
      { code: 'EISDIR' }
    )
  }

  private enotdir(op: string, path: string): never {
    throw Object.assign(
      new Error(`ENOTDIR: not a directory, ${op} '${path}'`),
      { code: 'ENOTDIR' }
    )
  }

  private enotempty(op: string, path: string): never {
    throw Object.assign(
      new Error(`ENOTEMPTY: directory not empty, ${op} '${path}'`),
      { code: 'ENOTEMPTY' }
    )
  }

  // ============================================================================
  // IFileSystem implementation
  // ============================================================================

  async readFile(path: string, _options?: { encoding?: BufferEncoding } | BufferEncoding): Promise<string> {
    const entry = await this.getEntry(path)
    if (!entry) this.enoent('open', path)
    if (entry.type === 'dir') this.eisdir('read', path)
    return entry.content ?? ''
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const content = await this.readFile(path)
    return new TextEncoder().encode(content)
  }

  async writeFile(
    path: string,
    content: FileContent,
    _options?: { encoding?: BufferEncoding; mode?: number } | BufferEncoding
  ): Promise<void> {
    const normalized = this.normalizePath(path)

    // Ensure parent directory exists
    const parent = this.getParentPath(normalized)
    if (parent !== '/') {
      const parentEntry = await this.getEntry(parent)
      if (!parentEntry) this.enoent('open', parent)
      if (parentEntry.type !== 'dir') this.enotdir('open', parent)
    }

    const strContent = typeof content === 'string'
      ? content
      : new TextDecoder().decode(content)

    await this.setEntry(normalized, 'file', strContent, null, 0o644)
  }

  async appendFile(
    path: string,
    content: FileContent,
    _options?: { encoding?: BufferEncoding; mode?: number } | BufferEncoding
  ): Promise<void> {
    const existing = await this.getEntry(path)
    const existingContent = existing?.content ?? ''
    const appendContent = typeof content === 'string'
      ? content
      : new TextDecoder().decode(content)
    await this.writeFile(path, existingContent + appendContent)
  }

  async exists(path: string): Promise<boolean> {
    const entry = await this.getEntry(path)
    return entry !== null
  }

  async stat(path: string): Promise<FsStat> {
    const entry = await this.getEntry(path)
    if (!entry) this.enoent('stat', path)
    return {
      isFile: entry.type === 'file',
      isDirectory: entry.type === 'dir',
      isSymbolicLink: entry.type === 'symlink',
      size: entry.content?.length ?? 0,
      mode: entry.mode,
      mtime: new Date(entry.mtime),
    }
  }

  async lstat(path: string): Promise<FsStat> {
    // For D1FileSystem, lstat is the same as stat (no real symlink following)
    return this.stat(path)
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const normalized = this.normalizePath(path)
    const recursive = typeof options === 'object' ? options?.recursive : false
    const mode = 0o755  // Default directory mode

    if (recursive) {
      // Create all parent directories
      const parts = normalized.split('/').filter(Boolean)
      let current = ''
      for (const part of parts) {
        current += '/' + part
        const entry = await this.getEntry(current)
        if (!entry) {
          await this.setEntry(current, 'dir', null, null, mode)
        } else if (entry.type !== 'dir') {
          this.eexist('mkdir', current)
        }
      }
    } else {
      // Check parent exists
      const parent = this.getParentPath(normalized)
      if (parent !== '/') {
        const parentEntry = await this.getEntry(parent)
        if (!parentEntry) this.enoent('mkdir', parent)
        if (parentEntry.type !== 'dir') this.enotdir('mkdir', parent)
      }

      // Check target doesn't exist
      const existing = await this.getEntry(normalized)
      if (existing) this.eexist('mkdir', normalized)

      await this.setEntry(normalized, 'dir', null, null, mode)
    }
  }

  async readdir(path: string): Promise<string[]> {
    const normalized = this.normalizePath(path)

    // Check directory exists
    if (normalized !== '/') {
      const entry = await this.getEntry(normalized)
      if (!entry) this.enoent('scandir', normalized)
      if (entry.type !== 'dir') this.enotdir('scandir', normalized)
    }

    // Find direct children
    const prefix = normalized === '/' ? '/' : normalized + '/'
    const result = await this.db.prepare(
      'SELECT path FROM files WHERE session_id = ? AND path LIKE ? AND path NOT LIKE ?'
    ).bind(
      this.sessionId,
      prefix + '%',
      prefix + '%/%'  // Exclude nested paths
    ).all()

    const entries = (result.results as { path: string }[])
      .map(row => this.getBaseName(row.path))
      .filter(name => name && name !== '/')

    return entries.sort()
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    const normalized = this.normalizePath(path)
    const force = options?.force ?? false
    const recursive = options?.recursive ?? false

    const entry = await this.getEntry(normalized)
    if (!entry) {
      if (force) return
      this.enoent('rm', normalized)
    }

    if (entry.type === 'dir') {
      // Check if directory is empty
      const children = await this.readdir(normalized)
      if (children.length > 0) {
        if (!recursive) this.enotempty('rm', normalized)
        // Delete all children recursively
        await this.deleteEntriesWithPrefix(normalized)
        return
      }
    }

    await this.deleteEntry(normalized)
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    const srcNorm = this.normalizePath(src)
    const destNorm = this.normalizePath(dest)
    const recursive = options?.recursive ?? false

    const srcEntry = await this.getEntry(srcNorm)
    if (!srcEntry) this.enoent('cp', srcNorm)

    if (srcEntry.type === 'dir') {
      if (!recursive) {
        throw Object.assign(
          new Error(`cp: -r not specified; omitting directory '${src}'`),
          { code: 'EISDIR' }
        )
      }

      // Create destination directory
      await this.mkdir(destNorm, { recursive: true })

      // Copy all children
      const prefix = srcNorm === '/' ? '/' : srcNorm + '/'
      const result = await this.db.prepare(
        'SELECT * FROM files WHERE session_id = ? AND path LIKE ?'
      ).bind(this.sessionId, prefix + '%').all()

      for (const row of result.results as unknown as FileRow[]) {
        const relativePath = row.path.slice(srcNorm.length)
        const newPath = destNorm + relativePath
        await this.setEntry(newPath, row.type, row.content, row.target, row.mode)
      }
    } else {
      // Copy single file
      await this.setEntry(destNorm, srcEntry.type, srcEntry.content, srcEntry.target, srcEntry.mode)
    }
  }

  async mv(src: string, dest: string): Promise<void> {
    await this.cp(src, dest, { recursive: true })
    await this.rm(src, { recursive: true })
  }

  resolvePath(base: string, path: string): string {
    if (path.startsWith('/')) return this.normalizePath(path)
    const baseDir = base.endsWith('/') ? base : base + '/'
    return this.normalizePath(baseDir + path)
  }

  getAllPaths(): string[] {
    // This is synchronous in the interface but we need async DB access
    // Return empty array - this method is optional and mainly used for glob
    // The bash glob implementation will work without it (falls back to readdir)
    return []
  }

  async chmod(path: string, mode: number): Promise<void> {
    const entry = await this.getEntry(path)
    if (!entry) this.enoent('chmod', path)
    await this.setEntry(path, entry.type, entry.content, entry.target, mode)
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    const normalized = this.normalizePath(linkPath)
    const existing = await this.getEntry(normalized)
    if (existing) this.eexist('symlink', normalized)
    await this.setEntry(normalized, 'symlink', null, target, 0o777)
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    const srcEntry = await this.getEntry(existingPath)
    if (!srcEntry) this.enoent('link', existingPath)
    if (srcEntry.type === 'dir') {
      throw Object.assign(
        new Error(`EPERM: operation not permitted, link '${existingPath}'`),
        { code: 'EPERM' }
      )
    }
    const existing = await this.getEntry(newPath)
    if (existing) this.eexist('link', newPath)
    await this.setEntry(newPath, 'file', srcEntry.content, null, srcEntry.mode)
  }

  async readlink(path: string): Promise<string> {
    const entry = await this.getEntry(path)
    if (!entry) this.enoent('readlink', path)
    if (entry.type !== 'symlink') {
      throw Object.assign(
        new Error(`EINVAL: invalid argument, readlink '${path}'`),
        { code: 'EINVAL' }
      )
    }
    return entry.target ?? ''
  }

  async realpath(path: string): Promise<string> {
    // Simple implementation - just normalize the path
    // Full symlink resolution would require following the chain
    const normalized = this.normalizePath(path)
    const entry = await this.getEntry(normalized)
    if (!entry) this.enoent('realpath', normalized)
    return normalized
  }

  async utimes(path: string, _atime: Date, mtime: Date): Promise<void> {
    const entry = await this.getEntry(path)
    if (!entry) this.enoent('utimes', path)

    await this.db.prepare(
      'UPDATE files SET mtime = ? WHERE session_id = ? AND path = ?'
    ).bind(mtime.getTime(), this.sessionId, this.normalizePath(path)).run()
  }

  // ============================================================================
  // Helper method to initialize root and common directories
  // ============================================================================

  async initializeDefaultDirectories(): Promise<void> {
    const dirs = ['/tmp', '/home', '/home/user']
    for (const dir of dirs) {
      const exists = await this.exists(dir)
      if (!exists) {
        await this.mkdir(dir, { recursive: true })
      }
    }
  }
}
