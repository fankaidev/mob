/**
 * Agent filesystem layer.
 *
 * Provides the factory to create the agent's filesystem:
 * - createAgentFs(db) → MountableFs with all persisted mounts restored
 */

export { createGitFs } from "./git-fs"
export { AgentFsAdapter } from "./agentfs-adapter"
export { saveMountRecord, removeMountRecord, restoreMounts, cloneAndMount } from "./mount-store"

import { MountableFs } from "../../just-bash/src/fs/mountable-fs/mountable-fs"
import { AgentFsAdapter } from "./agentfs-adapter"
import { restoreMounts } from "./mount-store"
import type { DbClient } from "../../../infra/gateway"

/**
 * Create the agent's filesystem and restore all persisted mounts from DB.
 *
 * Each Worker request creates a fresh MountableFs (Workers are stateless),
 * but the mount records in DB ensure git repos etc. are re-cloned and
 * mounted automatically.
 */
export async function createAgentFs(db: DbClient): Promise<MountableFs> {
  const base = new AgentFsAdapter(db)
  const fs = new MountableFs({ base })
  await restoreMounts(db, fs)
  return fs
}
