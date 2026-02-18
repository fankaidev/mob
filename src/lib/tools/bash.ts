import { Type, type Static } from '@sinclair/typebox'
import type { AgentTool } from '../pi-agent/types'
import { Bash } from 'just-bash'

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

Note: Files are persisted to D1 database after each command execution.`

interface BashToolOptions {
  sessionId: string
  db: D1Database
}

/**
 * Recursively collect all files from the filesystem
 */
async function collectFiles(bash: Bash, dirPath: string = '/'): Promise<Record<string, string>> {
  const files: Record<string, string> = {}

  try {
    const entries = await bash.fs.readdir(dirPath)

    for (const entry of entries) {
      if (entry === '.' || entry === '..') continue

      const fullPath = dirPath === '/' ? `/${entry}` : `${dirPath}/${entry}`

      try {
        const stat = await bash.fs.stat(fullPath)

        if (stat.isFile) {
          // Read file content
          const content = await bash.readFile(fullPath)
          files[fullPath] = content
        } else if (stat.isDirectory) {
          // Recursively collect files from subdirectory
          const subFiles = await collectFiles(bash, fullPath)
          Object.assign(files, subFiles)
        }
      } catch (err) {
        console.error(`Error processing ${fullPath}:`, err)
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err)
  }

  return files
}

/**
 * Save all files from bash filesystem to D1
 */
async function saveFilesToDB(bash: Bash, sessionId: string, db: D1Database) {
  const files = await collectFiles(bash)
  const now = Date.now()

  // Delete old files for this session
  await db.prepare('DELETE FROM files WHERE session_id = ?').bind(sessionId).run()

  // Insert all current files
  const statements = Object.entries(files).map(([path, content]) =>
    db.prepare(
      'INSERT INTO files (session_id, path, content, updated_at) VALUES (?, ?, ?, ?)'
    ).bind(sessionId, path, content, now)
  )

  if (statements.length > 0) {
    await db.batch(statements)
  }
}

/**
 * Load files from D1 for bash initialization
 */
async function loadFilesFromDB(sessionId: string, db: D1Database): Promise<Record<string, string>> {
  const result = await db.prepare(
    'SELECT path, content FROM files WHERE session_id = ?'
  ).bind(sessionId).all()

  const files: Record<string, string> = {}
  for (const row of result.results as any[]) {
    files[row.path] = row.content
  }

  return files
}

export function createBashTool(options: BashToolOptions): AgentTool<typeof bashSchema> {
  let bashInstance: Bash | null = null
  const { sessionId, db } = options

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
      if (!bashInstance) {
        // Ensure process shim is available for just-bash
        ensureProcessShim()

        // Load files from D1
        const initialFiles = await loadFilesFromDB(sessionId, db)
        bashInstance = new Bash({ cwd: '/tmp', files: initialFiles })
        console.log(`Loaded ${Object.keys(initialFiles).length} files from D1 for session ${sessionId}`)
      }

      try {
        // Execute the command
        const result = await bashInstance.exec(args.command)

        // Save files to D1 after execution
        await saveFilesToDB(bashInstance, sessionId, db)
        console.log(`Saved filesystem state to D1 for session ${sessionId}`)

        // Combine stdout and stderr
        const output = [result.stdout, result.stderr]
          .filter(Boolean)
          .join('\n')

        // If command failed, throw error with output
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
