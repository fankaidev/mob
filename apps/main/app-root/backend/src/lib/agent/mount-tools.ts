/**
 * Mount / Unmount / List Mounts agent tools.
 *
 * Manages external filesystem mounts (git repos, future: Notion, Google Drive, etc.)
 * backed by the fs_mounts DB table for persistence across Worker requests.
 */

import { Type, type Static } from "@sinclair/typebox"
import type { AgentTool } from "../pi-agent/types"
import { MountableFs } from "../just-bash/src/fs/mountable-fs/mountable-fs"
import type { DbClient } from "../../infra/gateway"
import type { GitMountConfig } from "../../schema"
import { cloneAndMount, saveMountRecord, removeMountRecord, loadAllMounts } from "./fs/mount-store"

// ============================================================================
// Mount
// ============================================================================

const mountSchema = Type.Object({
  type: Type.String({ description: 'Mount type. Currently supported: "git"' }),
  mount_path: Type.String({ description: "Virtual path to mount at (e.g. /mnt/repo)" }),
  url: Type.Optional(Type.String({ description: "[git] HTTPS URL of the Git repository" })),
  ref: Type.Optional(Type.String({ description: "[git] Branch, tag, or commit to checkout" })),
  depth: Type.Optional(Type.Number({ description: "[git] Clone depth (default: 1, use 0 for full history)" })),
})

const MOUNT_DESCRIPTION = `Mount an external filesystem into the virtual directory. The mounted files can then be browsed using the bash tool (ls, cat, grep, etc.).

Supported types:
- "git": Clone a Git repository. Requires "url" (HTTPS). Optional: "ref" (branch/tag), "depth" (default 1).

Examples:
  mount(type="git", mount_path="/mnt/repo", url="https://github.com/owner/repo")
  mount(type="git", mount_path="/mnt/docs", url="https://github.com/owner/docs", ref="main", depth=1)

Notes:
- Files are loaded into memory, so very large repos may fail
- The mount is persisted and will be restored automatically on subsequent requests
- Use the "list_mounts" tool to see current mounts, "unmount" to remove one`

export function createMountTool(options: {
  mountableFs: MountableFs
  db: DbClient
}): AgentTool<typeof mountSchema> {
  const { mountableFs, db } = options

  return {
    label: "Mount",
    name: "mount",
    description: MOUNT_DESCRIPTION,
    parameters: mountSchema,
    execute: async (
      _toolCallId: string,
      args: Static<typeof mountSchema>,
      signal?: AbortSignal,
    ) => {
      if (signal?.aborted) throw new Error("Execution aborted")

      const { type, mount_path: mountPath } = args

      if (type === "git") {
        if (!args.url) throw new Error("url is required for git mount")
        if (!args.url.startsWith("https://")) throw new Error("Only HTTPS URLs are supported")

        const config: GitMountConfig = { url: args.url, depth: args.depth ?? 1 }
        if (args.ref) config.ref = args.ref

        let fileCount: number
        try {
          const result = await cloneAndMount(mountableFs, config, mountPath)
          fileCount = result.fileCount
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new Error(`Mount failed: ${msg}`)
        }

        await saveMountRecord(db, mountPath, "git", config as unknown as Record<string, unknown>)

        return {
          content: [{ type: "text" as const, text: `Mounted ${args.url}${args.ref ? ` (ref: ${args.ref})` : ""} → ${mountPath}\n${fileCount} files available.\n\nUse bash to explore: ls ${mountPath}` }],
          details: { mountPath, fileCount, url: args.url, ref: args.ref || "HEAD" },
        }
      }

      throw new Error(`Unsupported mount type: "${type}". Currently supported: "git"`)
    },
  }
}

// ============================================================================
// Unmount
// ============================================================================

const unmountSchema = Type.Object({
  mount_path: Type.String({ description: "The mount path to remove (e.g. /mnt/repo)" }),
})

export function createUnmountTool(options: {
  mountableFs: MountableFs
  db: DbClient
}): AgentTool<typeof unmountSchema> {
  const { mountableFs, db } = options

  return {
    label: "Unmount",
    name: "unmount",
    description: "Remove a mounted external filesystem. Use list_mounts to see current mounts.",
    parameters: unmountSchema,
    execute: async (
      _toolCallId: string,
      args: Static<typeof unmountSchema>,
    ) => {
      const { mount_path: mountPath } = args

      try { mountableFs.unmount(mountPath) } catch { /* not mounted in memory */ }
      await removeMountRecord(db, mountPath)

      return {
        content: [{ type: "text" as const, text: `Unmounted ${mountPath}` }],
        details: { mountPath },
      }
    },
  }
}

// ============================================================================
// List Mounts
// ============================================================================

const listMountsSchema = Type.Object({})

export function createListMountsTool(options: { db: DbClient }): AgentTool<typeof listMountsSchema> {
  return {
    label: "List Mounts",
    name: "list_mounts",
    description: "List all mounted external filesystems (git repos, etc.). Shows mount path, type, and source info.",
    parameters: listMountsSchema,
    execute: async () => {
      const mounts = await loadAllMounts(options.db)

      if (mounts.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No external filesystems are currently mounted." }],
          details: { count: 0 },
        }
      }

      const lines = mounts.map((m) => {
        const config = m.config as GitMountConfig
        const info = m.type === "git"
          ? `${config.url}${config.ref ? ` (ref: ${config.ref})` : ""}`
          : JSON.stringify(m.config)
        return `${m.mountPath}  [${m.type}]  ${info}`
      })

      return {
        content: [{ type: "text" as const, text: `${mounts.length} mount(s):\n${lines.join("\n")}` }],
        details: { count: mounts.length },
      }
    },
  }
}
