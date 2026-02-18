/**
 * Simple MountableFs implementation for Cloudflare Workers.
 *
 * Routes file operations to the appropriate filesystem based on mount paths.
 */

import type { IFileSystem, FsStat, FileContent, MkdirOptions, RmOptions, CpOptions, BufferEncoding } from 'just-bash'

export interface MountableFsOptions {
  base: IFileSystem
}

export class MountableFs implements IFileSystem {
  private base: IFileSystem
  private mounts: Map<string, IFileSystem> = new Map()

  constructor(options: MountableFsOptions) {
    this.base = options.base
  }

  mount(path: string, fs: IFileSystem): void {
    const normalized = this.normalizePath(path)
    this.mounts.set(normalized, fs)
  }

  unmount(path: string): void {
    const normalized = this.normalizePath(path)
    if (!this.mounts.has(normalized)) {
      throw new Error(`No filesystem mounted at ${path}`)
    }
    this.mounts.delete(normalized)
  }

  private normalizePath(p: string): string {
    if (!p || p === '/') return '/'
    let n = p.endsWith('/') && p !== '/' ? p.slice(0, -1) : p
    if (!n.startsWith('/')) n = `/${n}`
    return n
  }

  private resolve(path: string): { fs: IFileSystem; relativePath: string } {
    const normalized = this.normalizePath(path)

    // Find the longest matching mount
    let longestMount = ''
    let mountedFs: IFileSystem | null = null

    for (const [mountPath, fs] of this.mounts) {
      if (normalized === mountPath || normalized.startsWith(mountPath + '/')) {
        if (mountPath.length > longestMount.length) {
          longestMount = mountPath
          mountedFs = fs
        }
      }
    }

    if (mountedFs) {
      const relativePath = normalized === longestMount
        ? '/'
        : normalized.slice(longestMount.length)
      return { fs: mountedFs, relativePath }
    }

    return { fs: this.base, relativePath: normalized }
  }

  // IFileSystem implementation - delegate to resolved filesystem

  async readFile(path: string, options?: { encoding?: BufferEncoding } | BufferEncoding): Promise<string> {
    const { fs, relativePath } = this.resolve(path)
    return fs.readFile(relativePath, options)
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const { fs, relativePath } = this.resolve(path)
    return fs.readFileBuffer(relativePath)
  }

  async writeFile(path: string, content: FileContent, options?: { encoding?: BufferEncoding; mode?: number } | BufferEncoding): Promise<void> {
    const { fs, relativePath } = this.resolve(path)
    return fs.writeFile(relativePath, content, options)
  }

  async appendFile(path: string, content: FileContent, options?: { encoding?: BufferEncoding; mode?: number } | BufferEncoding): Promise<void> {
    const { fs, relativePath } = this.resolve(path)
    return fs.appendFile(relativePath, content, options)
  }

  async exists(path: string): Promise<boolean> {
    const { fs, relativePath } = this.resolve(path)
    return fs.exists(relativePath)
  }

  async stat(path: string): Promise<FsStat> {
    const { fs, relativePath } = this.resolve(path)
    return fs.stat(relativePath)
  }

  async lstat(path: string): Promise<FsStat> {
    const { fs, relativePath } = this.resolve(path)
    return fs.lstat(relativePath)
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const { fs, relativePath } = this.resolve(path)
    return fs.mkdir(relativePath, options)
  }

  async readdir(path: string): Promise<string[]> {
    const normalized = this.normalizePath(path)
    const { fs, relativePath } = this.resolve(path)

    // Get entries from the resolved filesystem
    const entries = await fs.readdir(relativePath)

    // If we're reading from base, also add mount points as directories
    if (fs === this.base) {
      const prefix = normalized === '/' ? '/' : normalized + '/'
      for (const mountPath of this.mounts.keys()) {
        if (mountPath.startsWith(prefix)) {
          const rest = mountPath.slice(prefix.length)
          const name = rest.split('/')[0]
          if (name && !entries.includes(name)) {
            entries.push(name)
          }
        }
        // Also handle direct child mounts
        if (normalized === '/' && !mountPath.slice(1).includes('/')) {
          const name = mountPath.slice(1)
          if (name && !entries.includes(name)) {
            entries.push(name)
          }
        }
      }
    }

    return entries.sort()
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    const { fs, relativePath } = this.resolve(path)
    return fs.rm(relativePath, options)
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    const srcResolved = this.resolve(src)
    const destResolved = this.resolve(dest)

    // If same filesystem, use its cp
    if (srcResolved.fs === destResolved.fs) {
      return srcResolved.fs.cp(srcResolved.relativePath, destResolved.relativePath, options)
    }

    // Cross-filesystem copy: read from src, write to dest
    const stat = await srcResolved.fs.stat(srcResolved.relativePath)
    if (stat.isDirectory) {
      throw new Error('Cross-filesystem directory copy not supported')
    }
    const content = await srcResolved.fs.readFileBuffer(srcResolved.relativePath)
    await destResolved.fs.writeFile(destResolved.relativePath, content)
  }

  async mv(src: string, dest: string): Promise<void> {
    await this.cp(src, dest)
    await this.rm(src)
  }

  resolvePath(base: string, path: string): string {
    if (path.startsWith('/')) return this.normalizePath(path)
    const baseDir = base.endsWith('/') ? base : base + '/'
    return this.normalizePath(baseDir + path)
  }

  getAllPaths(): string[] {
    // Combine paths from base and all mounts
    const paths = this.base.getAllPaths()
    for (const [mountPath, fs] of this.mounts) {
      const mountPaths = fs.getAllPaths()
      for (const p of mountPaths) {
        const fullPath = p === '/' ? mountPath : mountPath + p
        if (!paths.includes(fullPath)) {
          paths.push(fullPath)
        }
      }
    }
    return paths
  }

  async chmod(path: string, mode: number): Promise<void> {
    const { fs, relativePath } = this.resolve(path)
    return fs.chmod(relativePath, mode)
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    const { fs, relativePath } = this.resolve(linkPath)
    return fs.symlink(target, relativePath)
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    const { fs: fs1, relativePath: rel1 } = this.resolve(existingPath)
    const { fs: fs2, relativePath: rel2 } = this.resolve(newPath)
    if (fs1 !== fs2) {
      throw new Error('Cannot create hard link across filesystems')
    }
    return fs1.link(rel1, rel2)
  }

  async readlink(path: string): Promise<string> {
    const { fs, relativePath } = this.resolve(path)
    return fs.readlink(relativePath)
  }

  async realpath(path: string): Promise<string> {
    const { fs, relativePath } = this.resolve(path)
    return fs.realpath(relativePath)
  }

  async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    const { fs, relativePath } = this.resolve(path)
    return fs.utimes(relativePath, atime, mtime)
  }
}
