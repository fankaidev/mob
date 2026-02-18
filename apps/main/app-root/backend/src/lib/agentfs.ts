/**
 * AgentFS — PostgreSQL-backed Virtual Filesystem
 *
 * Ported from https://github.com/tursodatabase/agentfs (SQLite → PostgreSQL/Drizzle ORM)
 * Implements the same POSIX-like filesystem interface over PostgreSQL tables.
 */

import { eq, and, sql, asc } from 'drizzle-orm'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import { fsInode, fsDentry, fsData, fsSymlink } from '../schema'
import type * as schema from '../schema'

// ============================================================================
// Constants
// ============================================================================

export const S_IFMT  = 0o170000
export const S_IFREG = 0o100000
export const S_IFDIR = 0o040000
export const S_IFLNK = 0o120000

export const DEFAULT_FILE_MODE = S_IFREG | 0o644 // 33188
export const DEFAULT_DIR_MODE  = S_IFDIR | 0o755  // 16877

const ROOT_INO = 1
const DEFAULT_CHUNK_SIZE = 4096

// ============================================================================
// Types
// ============================================================================

export type FsErrorCode = 'ENOENT' | 'EEXIST' | 'EISDIR' | 'ENOTDIR' | 'ENOTEMPTY' | 'EPERM' | 'EINVAL'

export interface FsError extends Error {
  code: FsErrorCode
  path?: string
}

export interface Stats {
  ino: number
  mode: number
  nlink: number
  uid: number
  gid: number
  size: number
  atime: number
  mtime: number
  ctime: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

export interface DirEntry {
  name: string
  stats: Stats
}

export interface FilesystemStats {
  inodes: number
  bytesUsed: number
}

// ============================================================================
// Helpers
// ============================================================================

function createFsError(code: FsErrorCode, message: string, path?: string): FsError {
  const err = new Error(`${code}: ${message}${path ? ` '${path}'` : ''}`) as FsError
  err.code = code
  if (path) err.path = path
  return err
}

function createStats(data: {
  ino: number; mode: number; nlink: number; uid: number; gid: number
  size: number; atime: number; mtime: number; ctime: number
}): Stats {
  return {
    ...data,
    isFile: () => (data.mode & S_IFMT) === S_IFREG,
    isDirectory: () => (data.mode & S_IFMT) === S_IFDIR,
    isSymbolicLink: () => (data.mode & S_IFMT) === S_IFLNK,
  }
}

function nowEpoch() { return Math.floor(Date.now() / 1000) }

// ============================================================================
// AgentFS Class
// ============================================================================

type Db = NeonDatabase<typeof schema>

export class AgentFS {
  private db: Db
  private chunkSize: number

  constructor(db: Db, chunkSize: number = DEFAULT_CHUNK_SIZE) {
    this.db = db
    this.chunkSize = chunkSize
  }

  /** Ensure the root inode exists. Call once before using the filesystem. */
  async ensureRoot(): Promise<void> {
    const rows = await this.db
      .select({ ino: fsInode.ino })
      .from(fsInode)
      .where(eq(fsInode.ino, ROOT_INO))
      .limit(1)
    if (rows.length === 0) {
      const now = nowEpoch()
      await this.db.execute(sql`
        INSERT INTO "fs_inode" ("ino", "mode", "nlink", "uid", "gid", "size", "atime", "mtime", "ctime")
        VALUES (${ROOT_INO}, ${DEFAULT_DIR_MODE}, 0, 0, 0, 0, ${now}, ${now}, ${now})
      `)
      // Advance the serial sequence past the root inode
      await this.db.execute(sql`SELECT setval('fs_inode_ino_seq', GREATEST(${ROOT_INO}, (SELECT last_value FROM fs_inode_ino_seq)))`)
    }
  }

  // ---------- Path resolution ----------

  private normalizePath(path: string): string {
    const normalized = path.replace(/\/+$/, '') || '/'
    return normalized.startsWith('/') ? normalized : '/' + normalized
  }

  private splitPath(path: string): string[] {
    const normalized = this.normalizePath(path)
    if (normalized === '/') return []
    return normalized.split('/').filter(Boolean)
  }

  private async resolvePath(path: string): Promise<number | null> {
    const normalized = this.normalizePath(path)
    if (normalized === '/') return ROOT_INO

    const parts = this.splitPath(normalized)
    let currentIno = ROOT_INO

    for (const name of parts) {
      const result = await this.db
        .select({ ino: fsDentry.ino })
        .from(fsDentry)
        .where(and(eq(fsDentry.parentIno, currentIno), eq(fsDentry.name, name)))
        .limit(1)

      if (result.length === 0) return null
      currentIno = result[0].ino
    }

    return currentIno
  }

  private async resolvePathOrThrow(path: string, syscall: string): Promise<{ normalizedPath: string; ino: number }> {
    const normalizedPath = this.normalizePath(path)
    const ino = await this.resolvePath(normalizedPath)
    if (ino === null) {
      throw createFsError('ENOENT', `no such file or directory, ${syscall}`, normalizedPath)
    }
    return { normalizedPath, ino }
  }

  private async resolveParent(path: string): Promise<{ parentIno: number; name: string } | null> {
    const normalized = this.normalizePath(path)
    if (normalized === '/') return null

    const parts = this.splitPath(normalized)
    const name = parts[parts.length - 1]
    const parentPath = parts.length === 1 ? '/' : '/' + parts.slice(0, -1).join('/')
    const parentIno = await this.resolvePath(parentPath)
    if (parentIno === null) return null

    return { parentIno, name }
  }

  // ---------- Inode helpers ----------

  private async getInodeMode(ino: number): Promise<number | null> {
    const rows = await this.db
      .select({ mode: fsInode.mode })
      .from(fsInode)
      .where(eq(fsInode.ino, ino))
      .limit(1)
    return rows.length > 0 ? rows[0].mode : null
  }

  private async assertIsDirectory(ino: number, syscall: string, path: string): Promise<void> {
    const mode = await this.getInodeMode(ino)
    if (mode === null) throw createFsError('ENOENT', `no such file or directory, ${syscall}`, path)
    if ((mode & S_IFMT) !== S_IFDIR) throw createFsError('ENOTDIR', `not a directory, ${syscall}`, path)
  }

  private async assertIsFile(ino: number, syscall: string, path: string): Promise<void> {
    const mode = await this.getInodeMode(ino)
    if (mode === null) throw createFsError('ENOENT', `no such file or directory, ${syscall}`, path)
    if ((mode & S_IFMT) === S_IFDIR) throw createFsError('EISDIR', `illegal operation on a directory, ${syscall}`, path)
  }

  private async createInode(mode: number, uid = 0, gid = 0): Promise<number> {
    const now = nowEpoch()
    const [row] = await this.db.insert(fsInode).values({
      mode, uid, gid, nlink: 0, size: 0,
      atime: now, mtime: now, ctime: now,
    }).returning({ ino: fsInode.ino })
    return row.ino
  }

  private async createDentry(parentIno: number, name: string, ino: number): Promise<void> {
    await this.db.insert(fsDentry).values({ name, parentIno, ino })
    await this.db.update(fsInode)
      .set({ nlink: sql`${fsInode.nlink} + 1` })
      .where(eq(fsInode.ino, ino))
  }

  private async removeDentryAndMaybeInode(parentIno: number, name: string, ino: number): Promise<void> {
    await this.db.delete(fsDentry)
      .where(and(eq(fsDentry.parentIno, parentIno), eq(fsDentry.name, name)))
    await this.db.update(fsInode)
      .set({ nlink: sql`${fsInode.nlink} - 1` })
      .where(eq(fsInode.ino, ino))

    // Check if last link
    const rows = await this.db
      .select({ nlink: fsInode.nlink })
      .from(fsInode)
      .where(eq(fsInode.ino, ino))
      .limit(1)
    const nlink = rows.length > 0 ? rows[0].nlink : 0

    if (nlink <= 0) {
      await this.db.delete(fsData).where(eq(fsData.ino, ino))
      await this.db.delete(fsSymlink).where(eq(fsSymlink.ino, ino))
      await this.db.delete(fsInode).where(eq(fsInode.ino, ino))
    }
  }

  private async ensureParentDirs(path: string): Promise<void> {
    const parts = this.splitPath(path)
    parts.pop()

    let currentIno = ROOT_INO
    for (const name of parts) {
      const result = await this.db
        .select({ ino: fsDentry.ino })
        .from(fsDentry)
        .where(and(eq(fsDentry.parentIno, currentIno), eq(fsDentry.name, name)))
        .limit(1)

      if (result.length === 0) {
        const dirIno = await this.createInode(DEFAULT_DIR_MODE)
        await this.createDentry(currentIno, name, dirIno)
        currentIno = dirIno
      } else {
        await this.assertIsDirectory(result[0].ino, 'open', this.normalizePath(path))
        currentIno = result[0].ino
      }
    }
  }

  // ---------- File content helpers ----------

  private async updateFileContent(ino: number, content: string | Buffer): Promise<void> {
    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
    const now = nowEpoch()

    // Delete old chunks
    await this.db.delete(fsData).where(eq(fsData.ino, ino))

    // Write new chunks
    if (buffer.length > 0) {
      let chunkIndex = 0
      for (let offset = 0; offset < buffer.length; offset += this.chunkSize) {
        const chunk = buffer.subarray(offset, Math.min(offset + this.chunkSize, buffer.length))
        await this.db.insert(fsData).values({ ino, chunkIndex, data: Buffer.from(chunk) })
        chunkIndex++
      }
    }

    // Update size and mtime
    await this.db.update(fsInode)
      .set({ size: buffer.length, mtime: now })
      .where(eq(fsInode.ino, ino))
  }

  // ==================== Public Filesystem API ====================

  async stat(path: string): Promise<Stats> {
    const { normalizedPath, ino } = await this.resolvePathOrThrow(path, 'stat')

    const rows = await this.db.select().from(fsInode).where(eq(fsInode.ino, ino)).limit(1)
    if (rows.length === 0) throw createFsError('ENOENT', 'no such file or directory, stat', normalizedPath)

    const r = rows[0]
    return createStats({
      ino: r.ino, mode: r.mode, nlink: r.nlink,
      uid: r.uid, gid: r.gid,
      size: Number(r.size), atime: Number(r.atime),
      mtime: Number(r.mtime), ctime: Number(r.ctime),
    })
  }

  async readdir(path: string): Promise<string[]> {
    const { normalizedPath, ino } = await this.resolvePathOrThrow(path, 'scandir')
    await this.assertIsDirectory(ino, 'scandir', normalizedPath)

    const rows = await this.db
      .select({ name: fsDentry.name })
      .from(fsDentry)
      .where(eq(fsDentry.parentIno, ino))
      .orderBy(asc(fsDentry.name))

    return rows.map(r => r.name)
  }

  async readdirPlus(path: string): Promise<DirEntry[]> {
    const { normalizedPath, ino } = await this.resolvePathOrThrow(path, 'scandir')
    await this.assertIsDirectory(ino, 'scandir', normalizedPath)

    const rows = await this.db
      .select({
        name: fsDentry.name,
        ino: fsInode.ino,
        mode: fsInode.mode,
        nlink: fsInode.nlink,
        uid: fsInode.uid,
        gid: fsInode.gid,
        size: fsInode.size,
        atime: fsInode.atime,
        mtime: fsInode.mtime,
        ctime: fsInode.ctime,
      })
      .from(fsDentry)
      .innerJoin(fsInode, eq(fsDentry.ino, fsInode.ino))
      .where(eq(fsDentry.parentIno, ino))
      .orderBy(asc(fsDentry.name))

    return rows.map(r => ({
      name: r.name,
      stats: createStats({
        ino: r.ino, mode: r.mode, nlink: r.nlink,
        uid: r.uid, gid: r.gid,
        size: Number(r.size), atime: Number(r.atime),
        mtime: Number(r.mtime), ctime: Number(r.ctime),
      }),
    }))
  }

  async readFile(path: string, encoding?: BufferEncoding): Promise<string | Buffer> {
    const { normalizedPath, ino } = await this.resolvePathOrThrow(path, 'open')
    await this.assertIsFile(ino, 'open', normalizedPath)

    const chunks = await this.db
      .select({ data: fsData.data, chunkIndex: fsData.chunkIndex })
      .from(fsData)
      .where(eq(fsData.ino, ino))
      .orderBy(asc(fsData.chunkIndex))

    const buffers = chunks.map(ch => {
      if (ch.data instanceof Buffer) return ch.data
      return Buffer.from(ch.data)
    })
    const combined = buffers.length > 0 ? Buffer.concat(buffers) : Buffer.alloc(0)

    // Update atime
    await this.db.update(fsInode)
      .set({ atime: nowEpoch() })
      .where(eq(fsInode.ino, ino))

    if (encoding) return combined.toString(encoding)
    return combined
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    await this.ensureParentDirs(path)

    const normalizedPath = this.normalizePath(path)
    const ino = await this.resolvePath(normalizedPath)

    if (ino !== null) {
      // Overwrite existing file
      await this.assertIsFile(ino, 'open', normalizedPath)
      await this.updateFileContent(ino, content)
    } else {
      // Create new file
      const parent = await this.resolveParent(normalizedPath)
      if (!parent) throw createFsError('ENOENT', 'no such file or directory, open', normalizedPath)
      await this.assertIsDirectory(parent.parentIno, 'open', normalizedPath)

      const fileIno = await this.createInode(DEFAULT_FILE_MODE)
      await this.createDentry(parent.parentIno, parent.name, fileIno)
      await this.updateFileContent(fileIno, content)
    }
  }

  async mkdir(path: string): Promise<void> {
    const normalizedPath = this.normalizePath(path)

    const existing = await this.resolvePath(normalizedPath)
    if (existing !== null) throw createFsError('EEXIST', 'file already exists, mkdir', normalizedPath)

    const parent = await this.resolveParent(normalizedPath)
    if (!parent) throw createFsError('ENOENT', 'no such file or directory, mkdir', normalizedPath)
    await this.assertIsDirectory(parent.parentIno, 'mkdir', normalizedPath)

    const dirIno = await this.createInode(DEFAULT_DIR_MODE)
    await this.createDentry(parent.parentIno, parent.name, dirIno)
  }

  async rmdir(path: string): Promise<void> {
    const normalizedPath = this.normalizePath(path)
    if (normalizedPath === '/') throw createFsError('EPERM', 'operation not permitted on root directory, rmdir', '/')

    const { ino } = await this.resolvePathOrThrow(normalizedPath, 'rmdir')
    await this.assertIsDirectory(ino, 'rmdir', normalizedPath)

    // Check empty
    const children = await this.db
      .select({ name: fsDentry.name })
      .from(fsDentry)
      .where(eq(fsDentry.parentIno, ino))
      .limit(1)
    if (children.length > 0) throw createFsError('ENOTEMPTY', 'directory not empty, rmdir', normalizedPath)

    const parent = await this.resolveParent(normalizedPath)
    if (!parent) throw createFsError('EPERM', 'operation not permitted, rmdir', normalizedPath)

    await this.removeDentryAndMaybeInode(parent.parentIno, parent.name, ino)
  }

  async unlink(path: string): Promise<void> {
    const normalizedPath = this.normalizePath(path)
    if (normalizedPath === '/') throw createFsError('EPERM', 'operation not permitted on root, unlink', '/')

    const { ino } = await this.resolvePathOrThrow(normalizedPath, 'unlink')

    const mode = await this.getInodeMode(ino)
    if (mode !== null && (mode & S_IFMT) === S_IFDIR) {
      throw createFsError('EISDIR', 'illegal operation on a directory, unlink', normalizedPath)
    }

    const parent = (await this.resolveParent(normalizedPath))!
    await this.removeDentryAndMaybeInode(parent.parentIno, parent.name, ino)
  }

  async rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void> {
    const normalizedPath = this.normalizePath(path)
    const force = options?.force === true
    const recursive = options?.recursive === true

    if (normalizedPath === '/') throw createFsError('EPERM', 'operation not permitted on root, rm', '/')

    const ino = await this.resolvePath(normalizedPath)
    if (ino === null) {
      if (force) return
      throw createFsError('ENOENT', 'no such file or directory, rm', normalizedPath)
    }

    const mode = await this.getInodeMode(ino)
    if (mode === null) return

    const parent = await this.resolveParent(normalizedPath)
    if (!parent) throw createFsError('EPERM', 'operation not permitted, rm', normalizedPath)

    if ((mode & S_IFMT) === S_IFDIR) {
      if (!recursive) throw createFsError('EISDIR', 'illegal operation on a directory, rm', normalizedPath)
      await this.rmDirContentsRecursive(ino)
      await this.removeDentryAndMaybeInode(parent.parentIno, parent.name, ino)
      return
    }

    await this.removeDentryAndMaybeInode(parent.parentIno, parent.name, ino)
  }

  private async rmDirContentsRecursive(dirIno: number): Promise<void> {
    const children = await this.db
      .select({ name: fsDentry.name, ino: fsDentry.ino })
      .from(fsDentry)
      .where(eq(fsDentry.parentIno, dirIno))
      .orderBy(asc(fsDentry.name))

    for (const child of children) {
      const mode = await this.getInodeMode(child.ino)
      if (mode === null) continue

      if ((mode & S_IFMT) === S_IFDIR) {
        await this.rmDirContentsRecursive(child.ino)
      }
      await this.removeDentryAndMaybeInode(dirIno, child.name, child.ino)
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldNormalized = this.normalizePath(oldPath)
    const newNormalized = this.normalizePath(newPath)
    if (oldNormalized === newNormalized) return

    if (oldNormalized === '/') throw createFsError('EPERM', 'operation not permitted, rename', '/')
    if (newNormalized === '/') throw createFsError('EPERM', 'operation not permitted, rename', '/')

    const oldParent = await this.resolveParent(oldNormalized)
    if (!oldParent) throw createFsError('EPERM', 'operation not permitted, rename', oldNormalized)

    const newParent = await this.resolveParent(newNormalized)
    if (!newParent) throw createFsError('ENOENT', 'no such file or directory, rename', newNormalized)

    await this.assertIsDirectory(newParent.parentIno, 'rename', newNormalized)

    const { ino: oldIno } = await this.resolvePathOrThrow(oldNormalized, 'rename')

    // Check if destination exists, remove it if so
    const newIno = await this.resolvePath(newNormalized)
    if (newIno !== null) {
      await this.removeDentryAndMaybeInode(newParent.parentIno, newParent.name, newIno)
    }

    // Move dentry
    await this.db.update(fsDentry)
      .set({ parentIno: newParent.parentIno, name: newParent.name })
      .where(and(eq(fsDentry.parentIno, oldParent.parentIno), eq(fsDentry.name, oldParent.name)))

    // Update timestamps
    const now = nowEpoch()
    await this.db.update(fsInode).set({ ctime: now }).where(eq(fsInode.ino, oldIno))
    await this.db.update(fsInode)
      .set({ mtime: now, ctime: now })
      .where(eq(fsInode.ino, oldParent.parentIno))
    if (newParent.parentIno !== oldParent.parentIno) {
      await this.db.update(fsInode)
        .set({ mtime: now, ctime: now })
        .where(eq(fsInode.ino, newParent.parentIno))
    }
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const srcNormalized = this.normalizePath(src)
    const destNormalized = this.normalizePath(dest)
    if (srcNormalized === destNormalized) {
      throw createFsError('EINVAL', 'invalid argument, copyfile', destNormalized)
    }

    const { ino: srcIno } = await this.resolvePathOrThrow(srcNormalized, 'copyfile')
    await this.assertIsFile(srcIno, 'copyfile', srcNormalized)

    const srcRows = await this.db.select().from(fsInode).where(eq(fsInode.ino, srcIno)).limit(1)
    if (srcRows.length === 0) throw createFsError('ENOENT', 'no such file or directory, copyfile', srcNormalized)
    const srcRow = srcRows[0]

    const destParent = await this.resolveParent(destNormalized)
    if (!destParent) throw createFsError('ENOENT', 'no such file or directory, copyfile', destNormalized)
    await this.assertIsDirectory(destParent.parentIno, 'copyfile', destNormalized)

    const now = nowEpoch()
    const destIno = await this.resolvePath(destNormalized)

    if (destIno !== null) {
      // Overwrite existing
      await this.assertIsFile(destIno, 'copyfile', destNormalized)
      await this.db.delete(fsData).where(eq(fsData.ino, destIno))

      // Copy chunks from src to dest
      const chunks = await this.db
        .select({ chunkIndex: fsData.chunkIndex, data: fsData.data })
        .from(fsData)
        .where(eq(fsData.ino, srcIno))
        .orderBy(asc(fsData.chunkIndex))
      for (const chunk of chunks) {
        const buf = chunk.data instanceof Buffer ? chunk.data : Buffer.from(chunk.data)
        await this.db.insert(fsData).values({ ino: destIno, chunkIndex: chunk.chunkIndex, data: buf })
      }

      await this.db.update(fsInode)
        .set({ mode: srcRow.mode, uid: srcRow.uid, gid: srcRow.gid, size: srcRow.size, mtime: now, ctime: now })
        .where(eq(fsInode.ino, destIno))
    } else {
      // Create new file
      const newIno = await this.createInode(srcRow.mode, srcRow.uid, srcRow.gid)
      await this.createDentry(destParent.parentIno, destParent.name, newIno)

      const chunks = await this.db
        .select({ chunkIndex: fsData.chunkIndex, data: fsData.data })
        .from(fsData)
        .where(eq(fsData.ino, srcIno))
        .orderBy(asc(fsData.chunkIndex))
      for (const chunk of chunks) {
        const buf = chunk.data instanceof Buffer ? chunk.data : Buffer.from(chunk.data)
        await this.db.insert(fsData).values({ ino: newIno, chunkIndex: chunk.chunkIndex, data: buf })
      }

      await this.db.update(fsInode)
        .set({ size: srcRow.size, mtime: now, ctime: now })
        .where(eq(fsInode.ino, newIno))
    }
  }

  async symlink(target: string, linkpath: string): Promise<void> {
    const normalizedLinkpath = this.normalizePath(linkpath)
    const existing = await this.resolvePath(normalizedLinkpath)
    if (existing !== null) throw createFsError('EEXIST', 'file already exists, symlink', normalizedLinkpath)

    const parent = await this.resolveParent(normalizedLinkpath)
    if (!parent) throw createFsError('ENOENT', 'no such file or directory, symlink', normalizedLinkpath)
    await this.assertIsDirectory(parent.parentIno, 'open', normalizedLinkpath)

    const mode = S_IFLNK | 0o777
    const symlinkIno = await this.createInode(mode)
    await this.createDentry(parent.parentIno, parent.name, symlinkIno)

    await this.db.insert(fsSymlink).values({ ino: symlinkIno, target })
    await this.db.update(fsInode)
      .set({ size: target.length })
      .where(eq(fsInode.ino, symlinkIno))
  }

  async readlink(path: string): Promise<string> {
    const { normalizedPath, ino } = await this.resolvePathOrThrow(path, 'open')

    const mode = await this.getInodeMode(ino)
    if (mode === null || (mode & S_IFMT) !== S_IFLNK) {
      throw createFsError('EINVAL', 'invalid argument, readlink', normalizedPath)
    }

    const rows = await this.db
      .select({ target: fsSymlink.target })
      .from(fsSymlink)
      .where(eq(fsSymlink.ino, ino))
      .limit(1)
    if (rows.length === 0) throw createFsError('ENOENT', 'no such file or directory, readlink', normalizedPath)

    return rows[0].target
  }

  async access(path: string): Promise<void> {
    const normalizedPath = this.normalizePath(path)
    const ino = await this.resolvePath(normalizedPath)
    if (ino === null) throw createFsError('ENOENT', 'no such file or directory, access', normalizedPath)
  }

  async statfs(): Promise<FilesystemStats> {
    const inodeRows = await this.db.select({ count: sql<number>`count(*)` }).from(fsInode)
    const bytesRows = await this.db.select({ total: sql<number>`coalesce(sum(length(data)), 0)` }).from(fsData)

    return {
      inodes: Number(inodeRows[0].count),
      bytesUsed: Number(bytesRows[0].total),
    }
  }
}
