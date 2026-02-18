/**
 * AgentFS Adapter — wraps AgentFS (PostgreSQL-backed) to implement IFileSystem (just-bash interface).
 *
 * This adapter bridges between:
 * - AgentFS: POSIX-like filesystem over PostgreSQL (inodes, dentries, chunked data)
 * - IFileSystem: The abstract filesystem interface used by just-bash
 */

import type {
  IFileSystem,
  FsStat,
  DirentEntry,
  MkdirOptions,
  RmOptions,
  CpOptions,
  ReadFileOptions,
  WriteFileOptions,
  BufferEncoding,
  FileContent,
} from '../../just-bash/src/fs/interface'
import { AgentFS, S_IFMT, S_IFREG, S_IFDIR, S_IFLNK } from '../../agentfs'
import type { DbClient } from '../../../infra/gateway'

function getEncoding(options?: ReadFileOptions | WriteFileOptions | BufferEncoding | null): BufferEncoding {
  if (!options) return 'utf-8'
  if (typeof options === 'string') return options
  return options.encoding ?? 'utf-8'
}

export class AgentFsAdapter implements IFileSystem {
  private fs: AgentFS
  private initialized = false

  constructor(db: DbClient) {
    this.fs = new AgentFS(db)
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.fs.ensureRoot()
      this.initialized = true
    }
  }

  // ---------- Path helpers ----------

  private normalizePath(path: string): string {
    if (!path || path === '/') return '/'
    let normalized = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path
    if (!normalized.startsWith('/')) {
      normalized = `/${normalized}`
    }
    // Resolve . and ..
    const parts = normalized.split('/').filter((p) => p && p !== '.')
    const resolved: string[] = []
    for (const part of parts) {
      if (part === '..') {
        resolved.pop()
      } else {
        resolved.push(part)
      }
    }
    const result = `/${resolved.join('/')}`
    return result === '/' ? '/' : result
  }

  resolvePath(base: string, path: string): string {
    if (path.startsWith('/')) {
      return this.normalizePath(path)
    }
    const combined = base === '/' ? `/${path}` : `${base}/${path}`
    return this.normalizePath(combined)
  }

  // ---------- Read operations ----------

  async readFile(path: string, options?: ReadFileOptions | BufferEncoding): Promise<string> {
    await this.ensureInit()
    const encoding = getEncoding(options)
    const result = await this.fs.readFile(path, encoding)
    return typeof result === 'string' ? result : result.toString(encoding)
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    await this.ensureInit()
    const result = await this.fs.readFile(path)
    if (result instanceof Uint8Array) return result
    if (typeof result === 'string') return new TextEncoder().encode(result)
    // Buffer is a subclass of Uint8Array
    return new Uint8Array(result)
  }

  // ---------- Write operations ----------

  async writeFile(path: string, content: FileContent, _options?: WriteFileOptions | BufferEncoding): Promise<void> {
    await this.ensureInit()
    if (content instanceof Uint8Array) {
      await this.fs.writeFile(path, Buffer.from(content))
    } else {
      await this.fs.writeFile(path, content)
    }
  }

  async appendFile(path: string, content: FileContent, options?: WriteFileOptions | BufferEncoding): Promise<void> {
    await this.ensureInit()
    // AgentFS doesn't have a native append, so read + write
    let existing = ''
    try {
      const result = await this.fs.readFile(path, 'utf-8')
      existing = typeof result === 'string' ? result : result.toString('utf-8')
    } catch {
      // File doesn't exist yet, that's fine
    }
    const encoding = getEncoding(options)
    const newContent = typeof content === 'string' ? content : Buffer.from(content).toString(encoding)
    await this.fs.writeFile(path, existing + newContent)
  }

  // ---------- Existence and stat ----------

  async exists(path: string): Promise<boolean> {
    await this.ensureInit()
    try {
      await this.fs.stat(path)
      return true
    } catch {
      return false
    }
  }

  async stat(path: string): Promise<FsStat> {
    await this.ensureInit()
    const stats = await this.fs.stat(path)
    return {
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymbolicLink: false, // stat follows symlinks
      mode: stats.mode & ~S_IFMT, // Strip file type bits, keep permission bits
      size: stats.size,
      mtime: new Date(stats.mtime * 1000),
    }
  }

  async lstat(path: string): Promise<FsStat> {
    // AgentFS doesn't distinguish stat/lstat at the API level,
    // but we can check the mode bits to detect symlinks
    await this.ensureInit()
    const stats = await this.fs.stat(path)
    const isSymlink = stats.isSymbolicLink()
    return {
      isFile: !isSymlink && stats.isFile(),
      isDirectory: !isSymlink && stats.isDirectory(),
      isSymbolicLink: isSymlink,
      mode: stats.mode & ~S_IFMT,
      size: stats.size,
      mtime: new Date(stats.mtime * 1000),
    }
  }

  // ---------- Directory operations ----------

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    await this.ensureInit()
    if (options?.recursive) {
      // Create each directory in the path
      const parts = this.normalizePath(path).split('/').filter(Boolean)
      let current = ''
      for (const part of parts) {
        current = `${current}/${part}`
        try {
          const stats = await this.fs.stat(current)
          if (stats.isDirectory()) continue
          throw new Error(`EEXIST: file already exists, mkdir '${path}'`)
        } catch (e: any) {
          if (e.code === 'ENOENT' || (e.message && e.message.includes('ENOENT'))) {
            await this.fs.mkdir(current)
          } else {
            throw e
          }
        }
      }
    } else {
      await this.fs.mkdir(path)
    }
  }

  async readdir(path: string): Promise<string[]> {
    await this.ensureInit()
    return this.fs.readdir(path)
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    await this.ensureInit()
    const entries = await this.fs.readdirPlus(path)
    return entries.map((entry) => ({
      name: entry.name,
      isFile: entry.stats.isFile(),
      isDirectory: entry.stats.isDirectory(),
      isSymbolicLink: entry.stats.isSymbolicLink(),
    }))
  }

  // ---------- Remove operations ----------

  async rm(path: string, options?: RmOptions): Promise<void> {
    await this.ensureInit()
    await this.fs.rm(path, {
      force: options?.force,
      recursive: options?.recursive,
    })
  }

  // ---------- Copy / Move ----------

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    await this.ensureInit()
    const stats = await this.fs.stat(src)
    if (stats.isFile()) {
      await this.fs.copyFile(src, dest)
    } else if (stats.isDirectory()) {
      if (!options?.recursive) {
        throw new Error(`EISDIR: is a directory, cp '${src}'`)
      }
      // Recursive directory copy
      try {
        await this.fs.mkdir(dest)
      } catch {
        // May already exist
      }
      const children = await this.fs.readdir(src)
      for (const child of children) {
        const srcChild = src === '/' ? `/${child}` : `${src}/${child}`
        const destChild = dest === '/' ? `/${child}` : `${dest}/${child}`
        await this.cp(srcChild, destChild, options)
      }
    }
  }

  async mv(src: string, dest: string): Promise<void> {
    await this.ensureInit()
    await this.fs.rename(src, dest)
  }

  // ---------- Permissions ----------

  async chmod(path: string, mode: number): Promise<void> {
    // AgentFS doesn't expose chmod directly, but we can work around it
    // For now, this is a no-op since the virtual fs doesn't enforce permissions
    await this.ensureInit()
    void path
    void mode
  }

  // ---------- Symlinks ----------

  async symlink(target: string, linkPath: string): Promise<void> {
    await this.ensureInit()
    await this.fs.symlink(target, linkPath)
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    // AgentFS doesn't have a direct hard link API, simulate with copy
    await this.ensureInit()
    await this.fs.copyFile(existingPath, newPath)
  }

  async readlink(path: string): Promise<string> {
    await this.ensureInit()
    return this.fs.readlink(path)
  }

  // ---------- Realpath ----------

  async realpath(path: string): Promise<string> {
    // AgentFS resolves symlinks during path resolution internally.
    // For now, verify the path exists and return normalized path.
    await this.ensureInit()
    await this.fs.stat(path) // throws ENOENT if not found
    return this.normalizePath(path)
  }

  // ---------- Timestamps ----------

  async utimes(path: string, _atime: Date, _mtime: Date): Promise<void> {
    // AgentFS doesn't expose utimes directly
    await this.ensureInit()
    void path
  }

  // ---------- Utilities ----------

  getAllPaths(): string[] {
    // This would require a full DB scan - return empty for now
    // just-bash uses this for glob matching, which can fall back to readdir
    return []
  }
}
