/**
 * Git command for just-bash
 */

import { defineCommand, type CommandContext, type ExecResult } from 'just-bash'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/web'
import { GIT_MOUNT_PATH, isInGitMount, adaptFs, parseArgs } from './git-utils'

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
