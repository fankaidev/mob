import { Type, type Static } from '@sinclair/typebox'
import { Bash } from 'just-bash'
import type { IFileSystem } from '../fs'
import type { AgentTool } from '../pi-agent/types'
import { ghCommand, gitCommand } from './bash-commands'

// ============================================================================
// Process shim for just-bash (Workers don't have full process object)
// ============================================================================
function ensureProcessShim() {
  if (typeof globalThis.process === 'undefined') {
    ;(globalThis as any).process = {
      pid: 1,
      ppid: 0,
      getuid: () => 1000,
      getgid: () => 1000,
      env: {},
      cwd: () => '/',
    }
  } else {
    const proc = globalThis.process as any
    if (proc.pid === undefined) proc.pid = 1
    if (proc.ppid === undefined) proc.ppid = 0
    if (!proc.getuid) proc.getuid = () => 1000
    if (!proc.getgid) proc.getgid = () => 1000
  }
}

const bashSchema = Type.Object({
  command: Type.String({
    description: 'Bash command to execute. You can use pipes, redirects, and other bash features.'
  }),
})

const BASH_TOOL_DESCRIPTION = `Execute bash commands in an isolated environment.

Available commands include:
- File operations: cat, ls, cp, mv, rm, mkdir, touch, head, tail, grep, sed, awk, find
- Text processing: echo, printf, wc, sort, uniq, tr, cut
- System info: pwd, whoami, env
- Git: git status, git add, git commit, git push, git checkout, git branch, git log
- GitHub CLI: gh pr create

Examples:
- List files: ls -la
- View file: cat README.md
- Search: grep "error" log.txt
- Pipe commands: cat data.txt | wc -l
- Git workflow: git checkout -b fix/typo && git add . && git commit -m "Fix typo" && git push
- Create PR: gh pr create --title "Fix typo" --body "Fixed a typo"

Note: The filesystem is shared with mounted repositories. Use 'ls /mnt' to see mounted repos.
Git commands require GITHUB_TOKEN environment variable for push and PR operations.`

interface BashToolOptions {
  sessionId: string
  db: D1Database
  fs: IFileSystem
}

/**
 * Create a shared bash instance for tools
 * This allows bash and file tools to share the same bash instance
 */
export async function createBashInstance(options: BashToolOptions): Promise<Bash> {
  const { fs } = options

  // Ensure process shim is available for just-bash
  ensureProcessShim()

  // Create bash with external filesystem (MountableFs) and custom commands
  const bashInstance = new Bash({
    cwd: '/work',
    fs: fs,
    customCommands: [gitCommand, ghCommand],
    network: {
      dangerouslyAllowFullInternetAccess: true,
    },
    python: true,
  })

  return bashInstance
}

export function createBashTool(bash: Bash): AgentTool<typeof bashSchema> {
  return {
    label: 'Bash',
    name: 'bash',
    description: BASH_TOOL_DESCRIPTION,
    parameters: bashSchema,
    execute: async (_toolCallId: string, args: Static<typeof bashSchema>, signal?: AbortSignal) => {
      // Check if execution was aborted
      if (signal?.aborted) {
        throw new Error('Execution aborted')
      }

      try {
        // Execute the command
        const result = await bash.exec(args.command)

        // Combine stdout and stderr
        const output = [result.stdout, result.stderr]
          .filter(Boolean)
          .join('\n')

        // If command failed, return error with output
        if (result.exitCode !== 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Command failed with exit code ${result.exitCode}:\n${output || '(no output)'}`
              }
            ],
            details: {
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.exitCode
            },
          }
        }

        // Return successful result
        return {
          content: [
            {
              type: 'text' as const,
              text: output || '(no output)'
            }
          ],
          details: {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode
          },
        }
      } catch (error) {
        // Handle execution errors
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error executing command: ${errorMessage}`
            }
          ],
          details: {
            error: errorMessage,
            exitCode: -1
          },
        }
      }
    },
  }
}
