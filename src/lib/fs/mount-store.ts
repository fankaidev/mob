/**
 * D1-backed mount persistence for git repositories.
 *
 * Stores/loads mount records in the mounts table.
 * On session startup, restoreMounts() re-clones all git mounts and mounts them
 * into the given MountableFs so the agent can browse them immediately.
 */

import git from 'isomorphic-git'
import http from 'isomorphic-git/http/web'
import { MountableFs } from './index'
import { createGitFs } from './git-fs'

/**
 * Git mount configuration
 */
export interface GitMountConfig {
  url: string
  ref?: string
  depth?: number
  token?: string
}

/**
 * Mount record from database
 */
export interface MountRecord {
  id: number
  session_id: string
  mount_path: string
  type: string
  config: string  // JSON string
  created_at: number
  updated_at: number
}

/**
 * Save a mount record. Upserts on (session_id, mount_path) so re-cloning
 * the same path just updates the config.
 */
export async function saveMountRecord(
  db: D1Database,
  sessionId: string,
  mountPath: string,
  type: string,
  config: GitMountConfig,
): Promise<void> {
  const now = Date.now()
  const configJson = JSON.stringify(config)

  // Try to update first, then insert if no rows affected
  const updateResult = await db.prepare(
    'UPDATE mounts SET type = ?, config = ?, updated_at = ? WHERE session_id = ? AND mount_path = ?'
  ).bind(type, configJson, now, sessionId, mountPath).run()

  if (updateResult.meta.changes === 0) {
    await db.prepare(
      'INSERT INTO mounts (session_id, mount_path, type, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(sessionId, mountPath, type, configJson, now, now).run()
  }
}

/**
 * Remove a mount record by session and mount path.
 */
export async function removeMountRecord(
  db: D1Database,
  sessionId: string,
  mountPath: string,
): Promise<void> {
  await db.prepare(
    'DELETE FROM mounts WHERE session_id = ? AND mount_path = ?'
  ).bind(sessionId, mountPath).run()
}

/**
 * Load all mount records for a session.
 */
export async function loadSessionMounts(
  db: D1Database,
  sessionId: string,
): Promise<MountRecord[]> {
  const result = await db.prepare(
    'SELECT * FROM mounts WHERE session_id = ?'
  ).bind(sessionId).all()

  return result.results as unknown as MountRecord[]
}

/**
 * Clone a git repo into memory and mount it.
 * Returns file count for confirmation.
 */
export async function cloneAndMount(
  mountableFs: MountableFs,
  config: GitMountConfig,
  mountPath: string,
): Promise<{ fileCount: number }> {
  const { ifs: repoFs, isogitFs } = createGitFs()

  const cloneOpts: Parameters<typeof git.clone>[0] = {
    fs: isogitFs,
    http,
    dir: '/',
    url: config.url,
    singleBranch: true,
    noTags: true,
  }

  if (config.ref) cloneOpts.ref = config.ref
  if (config.depth && config.depth > 0) cloneOpts.depth = config.depth
  if (config.token) {
    cloneOpts.onAuth = () => ({ username: config.token! })
  }

  await git.clone(cloneOpts)

  // Unmount previous mount at this path if any
  try { mountableFs.unmount(mountPath) } catch { /* not mounted */ }
  mountableFs.mount(mountPath, repoFs)

  const allFiles = repoFs.getAllPaths().filter((p) => !p.startsWith('/.git') && p !== '/')
  return { fileCount: allFiles.length }
}

/**
 * Restore all mounts from DB into the given MountableFs.
 * Re-clones each git mount. Failures are logged but don't block other mounts.
 */
export async function restoreMounts(
  db: D1Database,
  sessionId: string,
  mountableFs: MountableFs,
): Promise<void> {
  const mounts = await loadSessionMounts(db, sessionId)

  for (const mount of mounts) {
    try {
      if (mount.type === 'git') {
        const config = JSON.parse(mount.config) as GitMountConfig
        await cloneAndMount(mountableFs, config, mount.mount_path)
        console.log(`Restored mount: ${mount.mount_path} from ${config.url}`)
      }
      // Future: handle "notion", "gdrive", etc.
    } catch (err) {
      console.error(`Failed to restore mount ${mount.mount_path}:`, err)
      // Skip failed mounts — the agent can still work with other mounts
    }
  }
}
