/**
 * Git and GitHub CLI commands for just-bash
 *
 * Implements git and gh commands using isomorphic-git and GitHub REST API.
 */

import { defineCommand, type CommandContext, type ExecResult } from 'just-bash'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/web'

// Polyfill Buffer for isomorphic-git in Workers environment
import { Buffer } from 'buffer'
if (typeof globalThis.Buffer === 'undefined') {
  ;(globalThis as any).Buffer = Buffer
}

// Fixed mount path for git repositories - must match mount-tools.ts
const GIT_MOUNT_PATH = '/mnt/git'

/**
 * Check if the current working directory is within the git mount path
 */
function isInGitMount(cwd: string): boolean {
  return cwd === GIT_MOUNT_PATH || cwd.startsWith(GIT_MOUNT_PATH + '/')
}

/**
 * Adapt IFileSystem to isomorphic-git's fs.promises interface
 */
function adaptFs(ctx: CommandContext) {
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
 * Format git status output
 */
function formatStatusMatrix(matrix: [string, number, number, number][]): string {
  const lines: string[] = []
  const staged: string[] = []
  const unstaged: string[] = []
  const untracked: string[] = []

  for (const [filepath, head, workdir, stage] of matrix) {
    // Skip .git directory
    if (filepath.startsWith('.git')) continue

    // HEAD: 0 = absent, 1 = present
    // WORKDIR: 0 = absent, 1 = identical to HEAD, 2 = modified
    // STAGE: 0 = absent, 1 = identical to HEAD, 2 = identical to WORKDIR, 3 = modified differently

    if (head === 0 && workdir === 2 && stage === 0) {
      untracked.push(filepath)
    } else if (stage === 2 || stage === 3) {
      staged.push(filepath)
    } else if (workdir === 2 && stage === 1) {
      unstaged.push(filepath)
    } else if (head === 1 && workdir === 0) {
      staged.push(`deleted: ${filepath}`)
    }
  }

  if (staged.length > 0) {
    lines.push('Changes to be committed:')
    for (const f of staged) {
      lines.push(`  ${f}`)
    }
    lines.push('')
  }

  if (unstaged.length > 0) {
    lines.push('Changes not staged for commit:')
    for (const f of unstaged) {
      lines.push(`  modified: ${f}`)
    }
    lines.push('')
  }

  if (untracked.length > 0) {
    lines.push('Untracked files:')
    for (const f of untracked) {
      lines.push(`  ${f}`)
    }
    lines.push('')
  }

  if (lines.length === 0) {
    return 'nothing to commit, working tree clean'
  }

  return lines.join('\n')
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[], flags: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
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
async function parseRemoteUrl(fs: any, dir: string): Promise<{ owner: string; repo: string }> {
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

// ============================================================================
// Git Command
// ============================================================================

export const gitCommand = defineCommand('git', async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
  // Check if we're in the git mount directory
  if (!isInGitMount(ctx.cwd)) {
    return {
      stdout: '',
      stderr: `fatal: not a git repository (or any of the parent directories)\ngit commands only work in ${GIT_MOUNT_PATH}. Use 'cd ${GIT_MOUNT_PATH}' first.`,
      exitCode: 128,
    }
  }

  const subcommand = args[0]
  const subArgs = args.slice(1)
  const fs = adaptFs(ctx)
  // Always use GIT_MOUNT_PATH as the git root, even if we're in a subdirectory
  const dir = GIT_MOUNT_PATH

  try {
    switch (subcommand) {
      case 'status': {
        const matrix = await git.statusMatrix({ fs, dir })
        const output = formatStatusMatrix(matrix as [string, number, number, number][])
        return { stdout: output + '\n', stderr: '', exitCode: 0 }
      }

      case 'add': {
        if (subArgs.length === 0) {
          return { stdout: '', stderr: 'Nothing specified, nothing added.', exitCode: 1 }
        }

        for (const filepath of subArgs) {
          // Handle "git add ."
          if (filepath === '.') {
            const matrix = await git.statusMatrix({ fs, dir })
            for (const [file, head, workdir] of matrix) {
              if (file.startsWith('.git')) continue
              if (workdir !== 1) {  // Not identical to HEAD
                await git.add({ fs, dir, filepath: file })
              }
            }
          } else {
            await git.add({ fs, dir, filepath })
          }
        }
        return { stdout: '', stderr: '', exitCode: 0 }
      }

      case 'commit': {
        const { flags } = parseArgs(subArgs, ['m', 'message'])
        const message = (flags['m'] || flags['message']) as string

        if (!message) {
          return { stdout: '', stderr: 'error: switch `m` requires a value', exitCode: 1 }
        }

        const authorName = ctx.env.get('GIT_AUTHOR_NAME') || 'AI Agent'
        const authorEmail = ctx.env.get('GIT_AUTHOR_EMAIL') || 'agent@example.com'

        const sha = await git.commit({
          fs,
          dir,
          message,
          author: { name: authorName, email: authorEmail },
        })

        const branch = await git.currentBranch({ fs, dir }) || 'HEAD'
        return { stdout: `[${branch} ${sha.slice(0, 7)}] ${message}\n`, stderr: '', exitCode: 0 }
      }

      case 'push': {
        const token = ctx.env.get('GITHUB_TOKEN')
        if (!token) {
          return { stdout: '', stderr: 'error: GITHUB_TOKEN environment variable not set', exitCode: 1 }
        }

        const { flags } = parseArgs(subArgs, ['u', 'set-upstream'])
        const setUpstream = flags['u'] || flags['set-upstream']

        await git.push({
          fs,
          http,
          dir,
          onAuth: () => ({ username: token }),
        })

        return { stdout: 'Push successful\n', stderr: '', exitCode: 0 }
      }

      case 'checkout': {
        const { flags, positional } = parseArgs(subArgs, ['b'])
        const createBranch = flags['b']
        const branch = positional[0]

        if (!branch) {
          return { stdout: '', stderr: 'error: branch name required', exitCode: 1 }
        }

        if (createBranch) {
          await git.branch({ fs, dir, ref: branch })
        }

        await git.checkout({ fs, dir, ref: branch })
        return { stdout: `Switched to branch '${branch}'\n`, stderr: '', exitCode: 0 }
      }

      case 'branch': {
        if (subArgs.length === 0) {
          // List branches
          const branches = await git.listBranches({ fs, dir })
          const current = await git.currentBranch({ fs, dir })
          const output = branches.map(b => b === current ? `* ${b}` : `  ${b}`).join('\n')
          return { stdout: output + '\n', stderr: '', exitCode: 0 }
        } else {
          // Create branch
          const branchName = subArgs[0]
          await git.branch({ fs, dir, ref: branchName })
          return { stdout: '', stderr: '', exitCode: 0 }
        }
      }

      case 'log': {
        const { flags } = parseArgs(subArgs, ['n', 'oneline'])
        const depth = flags['n'] ? parseInt(flags['n'] as string, 10) : 10
        const oneline = flags['oneline']

        const commits = await git.log({ fs, dir, depth })

        if (oneline) {
          const output = commits.map(c =>
            `${c.oid.slice(0, 7)} ${c.commit.message.split('\n')[0]}`
          ).join('\n')
          return { stdout: output + '\n', stderr: '', exitCode: 0 }
        }

        const output = commits.map(c => {
          const date = new Date(c.commit.author.timestamp * 1000).toISOString()
          return `commit ${c.oid}\nAuthor: ${c.commit.author.name} <${c.commit.author.email}>\nDate:   ${date}\n\n    ${c.commit.message}\n`
        }).join('\n')

        return { stdout: output, stderr: '', exitCode: 0 }
      }

      default:
        return { stdout: '', stderr: `git: '${subcommand}' is not a git command`, exitCode: 1 }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { stdout: '', stderr: `error: ${msg}`, exitCode: 1 }
  }
})

// ============================================================================
// GitHub CLI Command
// ============================================================================

export const ghCommand = defineCommand('gh', async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
  // Check if we're in the git mount directory
  if (!isInGitMount(ctx.cwd)) {
    return {
      stdout: '',
      stderr: `error: gh commands only work in ${GIT_MOUNT_PATH}. Use 'cd ${GIT_MOUNT_PATH}' first.`,
      exitCode: 1,
    }
  }

  const [resource, action, ...actionArgs] = args

  if (resource === 'pr' && action === 'create') {
    return ghPrCreate(actionArgs, ctx)
  }

  return { stdout: '', stderr: `gh: unknown command "${resource} ${action}"`, exitCode: 1 }
})

async function ghPrCreate(args: string[], ctx: CommandContext): Promise<ExecResult> {
  const token = ctx.env.get('GITHUB_TOKEN')
  if (!token) {
    return { stdout: '', stderr: 'error: GITHUB_TOKEN environment variable not set', exitCode: 1 }
  }

  if (!ctx.fetch) {
    return { stdout: '', stderr: 'error: network access not configured', exitCode: 1 }
  }

  const { flags } = parseArgs(args, ['title', 'body', 'base', 't', 'b', 'B'])
  const title = (flags['title'] || flags['t']) as string
  const body = (flags['body'] || flags['b'] || '') as string
  const base = (flags['base'] || flags['B'] || 'main') as string

  if (!title) {
    return { stdout: '', stderr: 'error: --title flag is required', exitCode: 1 }
  }

  try {
    const fs = adaptFs(ctx)
    // Always use GIT_MOUNT_PATH as the git root
    const dir = GIT_MOUNT_PATH

    // Get owner/repo from remote
    const { owner, repo } = await parseRemoteUrl(fs, dir)

    // Get current branch as head
    const head = await git.currentBranch({ fs, dir })
    if (!head) {
      return { stdout: '', stderr: 'error: not on any branch', exitCode: 1 }
    }

    // Create PR via GitHub API
    // Note: ctx.fetch returns FetchResult { status, statusText, headers, body, url }
    const response = await ctx.fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, body, head, base }),
    })

    if (response.status >= 400) {
      let errorMsg = response.statusText
      try {
        const errorData = JSON.parse(response.body)
        errorMsg = errorData.message || errorMsg
      } catch {
        // Ignore JSON parse error
      }
      return { stdout: '', stderr: `error: ${errorMsg}`, exitCode: 1 }
    }

    const pr = JSON.parse(response.body) as { html_url: string; number: number }
    return { stdout: `${pr.html_url}\n`, stderr: '', exitCode: 0 }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { stdout: '', stderr: `error: ${msg}`, exitCode: 1 }
  }
}
