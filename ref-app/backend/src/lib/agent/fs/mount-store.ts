/**
 * DB-backed mount persistence.
 *
 * Stores/loads third-party mount records (git repos, etc.) in the fs_mounts table.
 * On agent startup, restoreMounts() re-clones all git mounts and mounts them
 * into the given MountableFs so the agent can browse them immediately.
 */

import { eq } from "drizzle-orm"
import git from "isomorphic-git"
import http from "isomorphic-git/http/web"
import type { DbClient } from "../../../infra/gateway"
import { fsMounts, type GitMountConfig } from "../../../schema"
import { MountableFs } from "../../just-bash/src/fs/mountable-fs/mountable-fs"
import { createGitFs } from "./git-fs"

/**
 * Save a mount record. Upserts on mount_path so re-cloning the same path
 * just updates the config.
 */
export async function saveMountRecord(
  db: DbClient,
  mountPath: string,
  type: string,
  config: Record<string, unknown>,
): Promise<void> {
  await db.insert(fsMounts)
    .values({ mountPath, type, config })
    .onConflictDoUpdate({
      target: fsMounts.mountPath,
      set: { type, config, updatedAt: new Date() },
    })
}

/**
 * Remove a mount record by mount path.
 */
export async function removeMountRecord(
  db: DbClient,
  mountPath: string,
): Promise<void> {
  await db.delete(fsMounts).where(eq(fsMounts.mountPath, mountPath))
}

/**
 * Load all mount records from DB.
 */
export async function loadAllMounts(db: DbClient) {
  return db.select().from(fsMounts)
}

/**
 * Clone a git repo into memory and mount it.
 * Extracted so both git-clone-tool and restoreMounts can reuse it.
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
    dir: "/",
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

  const allFiles = repoFs.getAllPaths().filter((p) => !p.startsWith("/.git") && p !== "/")
  return { fileCount: allFiles.length }
}

/**
 * Restore all mounts from DB into the given MountableFs.
 * Re-clones each git mount. Failures are logged but don't block other mounts.
 */
export async function restoreMounts(
  db: DbClient,
  mountableFs: MountableFs,
): Promise<void> {
  const mounts = await loadAllMounts(db)

  for (const mount of mounts) {
    try {
      if (mount.type === "git") {
        const config = mount.config as GitMountConfig
        await cloneAndMount(mountableFs, config, mount.mountPath)
      }
      // Future: handle "notion", "gdrive", etc.
    } catch {
      // Skip failed mounts — the agent can still work with other mounts
    }
  }
}
