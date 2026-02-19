/**
 * Shared utilities for git commands
 */

import git from 'isomorphic-git'
import type { CommandContext } from 'just-bash'

// Polyfill Buffer for isomorphic-git in Workers environment
import { Buffer } from 'buffer'
if (typeof globalThis.Buffer === 'undefined') {
  ;(globalThis as any).Buffer = Buffer
}

// Fixed mount path for git repositories - must match mount-tools.ts
export const GIT_MOUNT_PATH = '/mnt/git'

/**
 * Check if the current working directory is within the git mount path
 */
export function isInGitMount(cwd: string): boolean {
  return cwd === GIT_MOUNT_PATH || cwd.startsWith(GIT_MOUNT_PATH + '/')
}

/**
 * Adapt IFileSystem to isomorphic-git's fs.promises interface
 */
export function adaptFs(ctx: CommandContext) {
  return {
    promises: {
      readFile: async (path: string, opts?: { encoding?: string } | string) => {
        const encoding = typeof opts === 'string' ? opts : opts?.encoding
        if (encoding === 'utf8' || encoding === 'utf-8') {
          return ctx.fs.readFile(path)
        }
        // Return Uint8Array for binary reads
        return ctx.fs.readFileBuffer(path)
      },
      writeFile: async (path: string, data: string | Uint8Array) => {
        await ctx.fs.writeFile(path, data)
      },
      mkdir: async (path: string, opts?: { recursive?: boolean } | number) => {
        const recursive = typeof opts === 'object' ? opts?.recursive : false
        await ctx.fs.mkdir(path, { recursive })
      },
      readdir: async (path: string) => {
        return ctx.fs.readdir(path)
      },
      stat: async (path: string) => {
        const s = await ctx.fs.stat(path)
        return {
          isFile: () => s.isFile,
          isDirectory: () => s.isDirectory,
          isSymbolicLink: () => s.isSymbolicLink,
          size: s.size,
          mode: s.mode,
          mtimeMs: s.mtime.getTime(),
          uid: 1000,
          gid: 1000,
        }
      },
      lstat: async (path: string) => {
        const s = await ctx.fs.lstat(path)
        return {
          isFile: () => s.isFile,
          isDirectory: () => s.isDirectory,
          isSymbolicLink: () => s.isSymbolicLink,
          size: s.size,
          mode: s.mode,
          mtimeMs: s.mtime.getTime(),
          uid: 1000,
          gid: 1000,
        }
      },
      unlink: async (path: string) => {
        await ctx.fs.rm(path)
      },
      rmdir: async (path: string) => {
        await ctx.fs.rm(path, { recursive: true })
      },
      symlink: async (target: string, path: string) => {
        await ctx.fs.symlink(target, path)
      },
      readlink: async (path: string) => {
        return ctx.fs.readlink(path)
      },
      chmod: async (path: string, mode: number) => {
        await ctx.fs.chmod(path, mode)
      },
    },
  }
}

/**
 * Parse command line arguments
 */
export function parseArgs(args: string[], flags: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
  const result: Record<string, string | boolean> = {}
  const positional: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      if (flags.includes(key)) {
        // Check if next arg is the value
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          result[key] = args[++i]
        } else {
          result[key] = true
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1)
      if (flags.includes(key)) {
        // Check if next arg is the value
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          result[key] = args[++i]
        } else {
          result[key] = true
        }
      }
    } else {
      positional.push(arg)
    }
  }

  return { flags: result, positional }
}

/**
 * Parse owner/repo from git remote URL
 */
export async function parseRemoteUrl(fs: any, dir: string): Promise<{ owner: string; repo: string }> {
  try {
    const remotes = await git.listRemotes({ fs, dir })
    const origin = remotes.find(r => r.remote === 'origin')
    if (!origin) {
      throw new Error('No origin remote found')
    }

    const url = origin.url
    // Handle https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const match = url.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(\.git)?$/)
    if (!match) {
      throw new Error(`Cannot parse GitHub URL: ${url}`)
    }

    return { owner: match[1], repo: match[2] }
  } catch (error) {
    throw new Error(`Failed to parse remote URL: ${error}`)
  }
}
