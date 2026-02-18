import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../../types/env'
import { setupAuditContextMiddleware } from '../../middlewares/db'
import { AgentFS, type FsError } from '../../lib/agentfs'

function isFsError(err: unknown): err is FsError {
  return err instanceof Error && 'code' in err && typeof (err as FsError).code === 'string'
}

function toHttpException(err: unknown): HTTPException {
  if (!isFsError(err)) throw err
  const msg = err.message
  switch (err.code) {
    case 'ENOENT':    return new HTTPException(404, { message: msg })
    case 'EEXIST':    return new HTTPException(409, { message: msg })
    case 'EPERM':     return new HTTPException(403, { message: msg })
    case 'EISDIR':
    case 'ENOTDIR':
    case 'ENOTEMPTY':
    case 'EINVAL':    return new HTTPException(400, { message: msg })
    default:          throw err
  }
}

/** Create an AgentFS instance with root inode guaranteed to exist */
async function createFs(db: ConstructorParameters<typeof AgentFS>[0]) {
  const fs = new AgentFS(db)
  await fs.ensureRoot()
  return fs
}

const fileExplorerRoutes = new Hono<Env>()
  // GET /refresh - List directory contents with stats
  .get('/refresh', setupAuditContextMiddleware, async (c) => {
    const path = c.req.query('path') || '/'
    const fs = await createFs(c.var.db)

    try {
      const entries = await fs.readdirPlus(path)
      const fsStats = await fs.statfs()

      const items = entries.map(e => ({
        name: e.name,
        ino: e.stats.ino,
        isDirectory: e.stats.isDirectory(),
        isFile: e.stats.isFile(),
        isSymlink: e.stats.isSymbolicLink(),
        mode: e.stats.mode,
        size: e.stats.size,
        mtime: e.stats.mtime,
        ctime: e.stats.ctime,
      }))

      return c.json({
        path,
        items,
        stats: {
          totalInodes: fsStats.inodes,
          totalBytes: fsStats.bytesUsed,
        },
      })
    } catch (err) {
      throw toHttpException(err)
    }
  })

  // GET /read-file - Read file content as text
  .get('/read-file', setupAuditContextMiddleware, async (c) => {
    const path = c.req.query('path')
    if (!path) throw new HTTPException(400, { message: 'path is required' })
    const fs = await createFs(c.var.db)

    try {
      const content = await fs.readFile(path, 'utf-8') as string
      const stats = await fs.stat(path)

      return c.json({
        path,
        content,
        size: stats.size,
        mode: stats.mode,
        mtime: stats.mtime,
      })
    } catch (err) {
      throw toHttpException(err)
    }
  })

  // POST /write-file - Write file content (create or overwrite)
  .post('/write-file', setupAuditContextMiddleware, zValidator('json', z.object({
    path: z.string().min(1),
    content: z.string(),
  })), async (c) => {
    const { path, content } = c.req.valid('json')
    const fs = await createFs(c.var.db)

    try {
      await fs.writeFile(path, content)
      const stats = await fs.stat(path)
      return c.json({ success: true, path, size: stats.size })
    } catch (err) {
      throw toHttpException(err)
    }
  })

  // POST /mkdir - Create a directory
  .post('/mkdir', setupAuditContextMiddleware, zValidator('json', z.object({
    path: z.string().min(1),
  })), async (c) => {
    const { path } = c.req.valid('json')
    const fs = await createFs(c.var.db)

    try {
      await fs.mkdir(path)
      const stats = await fs.stat(path)
      return c.json({ success: true, path, ino: stats.ino })
    } catch (err) {
      throw toHttpException(err)
    }
  })

  // POST /delete - Delete a file or empty directory
  .post('/delete', setupAuditContextMiddleware, zValidator('json', z.object({
    path: z.string().min(1),
  })), async (c) => {
    const { path } = c.req.valid('json')
    const fs = await createFs(c.var.db)

    try {
      const stats = await fs.stat(path)
      if (stats.isDirectory()) {
        await fs.rmdir(path)
      } else {
        await fs.unlink(path)
      }
      return c.json({ success: true, path })
    } catch (err) {
      throw toHttpException(err)
    }
  })

  // POST /rename - Rename/move a file or directory
  .post('/rename', setupAuditContextMiddleware, zValidator('json', z.object({
    oldPath: z.string().min(1),
    newPath: z.string().min(1),
  })), async (c) => {
    const { oldPath, newPath } = c.req.valid('json')
    const fs = await createFs(c.var.db)

    try {
      await fs.rename(oldPath, newPath)
      return c.json({ success: true, oldPath, newPath })
    } catch (err) {
      throw toHttpException(err)
    }
  })

export { fileExplorerRoutes }
export type FileExplorerApi = typeof fileExplorerRoutes
