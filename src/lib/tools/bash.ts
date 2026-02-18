import { Type, type Static } from '@sinclair/typebox'
import type { AgentTool } from '../pi-agent/types'
import { Bash } from 'just-bash'
import type { IFileSystem } from '../fs'

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
- And many more standard Unix utilities

Examples:
- List files: ls -la
- View file: cat README.md
- Search: grep "error" log.txt
- Pipe commands: cat data.txt | wc -l

Note: The filesystem is shared with mounted repositories. Use 'ls /mnt' to see mounted repos.`

interface BashToolOptions {
  sessionId: string
  db: D1Database
  fs: IFileSystem
}

/**
 * Create a shared filesystem context for tools
 * This allows bash and file tools to share the same filesystem instance
 */
export function createFilesystemContext(options: BashToolOptions) {
  let bashInstance: Bash | null = null
  const { fs } = options

  const initBash = async () => {
    if (!bashInstance) {
      // Ensure process shim is available for just-bash
      ensureProcessShim()

      // Create bash with external filesystem (MountableFs)
      bashInstance = new Bash({
        cwd: '/tmp',
        fs: fs,
      })
      console.log(`Created bash instance with external filesystem`)
    }
    return bashInstance
  }

  // No-op since we use MountableFs which handles persistence via mount-store
  const saveFiles = async () => {
    // Files are persisted via mount records in D1, not individual files
  }

  return {
    getBash: () => bashInstance,
    initBash,
    saveFiles,
    fs,
  }
}

export function createBashTool(context: ReturnType<typeof createFilesystemContext>): AgentTool<typeof bashSchema> {
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

      // Initialize bash instance on first use
      const bashInstance = await context.initBash()

      try {
        // Execute the command
        const result = await bashInstance.exec(args.command)

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
