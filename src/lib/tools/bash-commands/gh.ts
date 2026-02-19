/**
 * GitHub CLI command for just-bash
 */

import { defineCommand, type CommandContext, type ExecResult } from 'just-bash'
import git from 'isomorphic-git'
import { GIT_MOUNT_PATH, isInGitMount, adaptFs, parseArgs, parseRemoteUrl } from './git-utils'

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
