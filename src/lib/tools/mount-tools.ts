/**
 * Mount tools for the agent to clone and browse git repositories.
 */

import { Type, type Static } from '@sinclair/typebox'
import type { AgentTool } from '../pi-agent/types'
import { MountableFs } from '../fs'
import {
  saveMountRecord,
  removeMountRecord,
  loadSessionMounts,
  cloneAndMount,
  type GitMountConfig,
} from '../fs/mount-store'

// ============================================================================
// Mount Tool - Clone and mount a git repository
// ============================================================================

// Fixed mount path for git repositories
export const GIT_MOUNT_PATH = '/mnt/git'

const mountSchema = Type.Object({
  url: Type.String({
    description: 'Git repository URL (e.g., https://github.com/owner/repo.git)',
  }),
  ref: Type.Optional(Type.String({
    description: 'Branch or tag to checkout (default: default branch)',
  })),
  depth: Type.Optional(Type.Number({
    description: 'Clone depth for shallow clone (default: 1 for shallow clone)',
  })),
  token: Type.Optional(Type.String({
    description: 'Personal access token for private repositories',
  })),
})

const MOUNT_TOOL_DESCRIPTION = `Mount a git repository to browse its files.

This tool clones a git repository into memory and mounts it at /mnt/git.
After mounting, you can browse the repository files using the bash tool.

Examples:
- Mount public repo: { "url": "https://github.com/facebook/react.git" }
- Mount with branch: { "url": "https://github.com/owner/repo.git", "ref": "develop" }
- Mount private repo: { "url": "https://github.com/owner/private.git", "token": "ghp_..." }

Notes:
- Default depth=1 (shallow clone) to save memory
- Repository is always mounted at /mnt/git
- Only one repository can be mounted at a time
- Files are persisted and restored across sessions
- Large repositories may take longer to clone`

interface MountToolOptions {
  mountableFs: MountableFs
  sessionId: string
  db: D1Database
}

export function createMountTool(options: MountToolOptions): AgentTool<typeof mountSchema> {
  const { mountableFs, sessionId, db } = options

  return {
    label: 'Mount Repository',
    name: 'mount',
    description: MOUNT_TOOL_DESCRIPTION,
    parameters: mountSchema,
    execute: async (_toolCallId: string, args: Static<typeof mountSchema>, signal?: AbortSignal) => {
      if (signal?.aborted) {
        throw new Error('Execution aborted')
      }

      try {
        // Prepare config
        const config: GitMountConfig = {
          url: args.url,
          ref: args.ref,
          depth: args.depth ?? 1,  // Default to shallow clone
          token: args.token,
        }

        // Clone and mount at fixed path
        const { fileCount } = await cloneAndMount(mountableFs, config, GIT_MOUNT_PATH)

        // Persist to D1
        await saveMountRecord(db, sessionId, GIT_MOUNT_PATH, 'git', config)

        return {
          content: [{
            type: 'text' as const,
            text: `Successfully mounted ${args.url} at ${GIT_MOUNT_PATH}\nFiles: ${fileCount}\n\nYou can now browse the repository using bash commands like:\n- ls ${GIT_MOUNT_PATH}\n- cat ${GIT_MOUNT_PATH}/README.md\n\nGit commands (git, gh) are available when working in ${GIT_MOUNT_PATH}.`,
          }],
          details: { fileCount, mountPath: GIT_MOUNT_PATH, url: args.url },
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{
            type: 'text' as const,
            text: `Error mounting repository: ${errorMessage}`,
          }],
          details: { error: errorMessage },
        }
      }
    },
  }
}

// ============================================================================
// Unmount Tool - Remove a mounted repository
// ============================================================================

const unmountSchema = Type.Object({})

const UNMOUNT_TOOL_DESCRIPTION = `Unmount the currently mounted git repository.

This removes the repository from the virtual filesystem and deletes the mount record.
No parameters required - unmounts from /mnt/git.`

export function createUnmountTool(options: MountToolOptions): AgentTool<typeof unmountSchema> {
  const { mountableFs, sessionId, db } = options

  return {
    label: 'Unmount Repository',
    name: 'unmount',
    description: UNMOUNT_TOOL_DESCRIPTION,
    parameters: unmountSchema,
    execute: async (_toolCallId: string, _args: Static<typeof unmountSchema>, signal?: AbortSignal) => {
      if (signal?.aborted) {
        throw new Error('Execution aborted')
      }

      try {
        // Unmount from filesystem
        mountableFs.unmount(GIT_MOUNT_PATH)

        // Remove from D1
        await removeMountRecord(db, sessionId, GIT_MOUNT_PATH)

        return {
          content: [{
            type: 'text' as const,
            text: `Successfully unmounted ${GIT_MOUNT_PATH}`,
          }],
          details: { mountPath: GIT_MOUNT_PATH },
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{
            type: 'text' as const,
            text: `Error unmounting: ${errorMessage}`,
          }],
          details: { error: errorMessage },
        }
      }
    },
  }
}

// ============================================================================
// List Mounts Tool - Show all mounted repositories
// ============================================================================

const listMountsSchema = Type.Object({})

const LIST_MOUNTS_TOOL_DESCRIPTION = `List all mounted repositories in the current session.

Returns information about each mounted repository including:
- Mount path
- Repository URL
- Branch/ref (if specified)

No parameters required.`

export function createListMountsTool(options: MountToolOptions): AgentTool<typeof listMountsSchema> {
  const { sessionId, db } = options

  return {
    label: 'List Mounts',
    name: 'list_mounts',
    description: LIST_MOUNTS_TOOL_DESCRIPTION,
    parameters: listMountsSchema,
    execute: async (_toolCallId: string, _args: Static<typeof listMountsSchema>, signal?: AbortSignal) => {
      if (signal?.aborted) {
        throw new Error('Execution aborted')
      }

      try {
        const mounts = await loadSessionMounts(db, sessionId)

        if (mounts.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: 'No repositories are currently mounted.\n\nUse the mount tool to clone a git repository.',
            }],
            details: { mounts: [] },
          }
        }

        const lines = mounts.map((mount) => {
          const config = JSON.parse(mount.config) as GitMountConfig
          let info = `${mount.mount_path}\n  URL: ${config.url}`
          if (config.ref) info += `\n  Ref: ${config.ref}`
          if (config.depth) info += `\n  Depth: ${config.depth}`
          return info
        })

        return {
          content: [{
            type: 'text' as const,
            text: `Mounted repositories:\n\n${lines.join('\n\n')}`,
          }],
          details: { mounts: mounts.map(m => ({ path: m.mount_path, config: JSON.parse(m.config) })) },
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{
            type: 'text' as const,
            text: `Error listing mounts: ${errorMessage}`,
          }],
          details: { error: errorMessage },
        }
      }
    },
  }
}
