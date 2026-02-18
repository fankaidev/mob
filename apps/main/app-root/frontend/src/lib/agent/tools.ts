import type { AgentTool } from '../pi-agent/src/index'
import { Type, type Static } from '@sinclair/typebox'
import type { IFileSystem } from '../just-bash/src/browser'
import type * as JustBash from '../just-bash/src/browser'
import { BASH_TOOL_DESCRIPTION, ARTIFACTS_TOOL_DESCRIPTION } from './prompts'

// ============================================================================
// Process shim for just-bash browser build
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

let justBashModule: typeof JustBash | null = null

async function loadJustBash() {
  if (!justBashModule) {
    ensureProcessShim()
    justBashModule = await import('../just-bash/src/browser')
  }
  return justBashModule
}

export async function createSharedFs(): Promise<IFileSystem> {
  try {
    const { OpfsBackedFs } = await import('../just-bash/src/fs/opfs-backed-fs/index')
    return await OpfsBackedFs.create()
  } catch {
    const { InMemoryFs } = await loadJustBash()
    return new InMemoryFs()
  }
}

// ============================================================================
// Bash Tool
// ============================================================================
const bashSchema = Type.Object({
  command: Type.String({ description: 'Bash command to execute' }),
})

export function createBashTool(options?: { fs?: IFileSystem }): AgentTool<typeof bashSchema> {
  let bashInstance: any | null = null

  return {
    label: 'Bash',
    name: 'bash',
    description: BASH_TOOL_DESCRIPTION,
    parameters: bashSchema,
    execute: async (_toolCallId: string, args: Static<typeof bashSchema>, signal?: AbortSignal) => {
      if (signal?.aborted) throw new Error('Execution aborted')

      if (!bashInstance) {
        const { Bash, InMemoryFs } = await loadJustBash()
        bashInstance = new Bash({ fs: options?.fs ?? new InMemoryFs(), cwd: '/home/user' })
      }

      const result = await bashInstance.exec(args.command)
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n')

      if (result.exitCode !== 0) {
        throw new Error(output || `Command failed with exit code ${result.exitCode}`)
      }

      return {
        content: [{ type: 'text' as const, text: output || '(no output)' }],
        details: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
      }
    },
  }
}

// ============================================================================
// Artifacts Tool
// ============================================================================
export interface Artifact {
  filename: string
  content: string
  createdAt: Date
  updatedAt: Date
}

const artifactsParamsSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal('create'),
      Type.Literal('update'),
      Type.Literal('rewrite'),
      Type.Literal('get'),
      Type.Literal('delete'),
    ],
    { description: 'The operation to perform' },
  ),
  filename: Type.String({ description: "Filename including extension (e.g., 'index.html', 'script.js')" }),
  content: Type.Optional(Type.String({ description: 'File content' })),
  old_str: Type.Optional(Type.String({ description: 'String to replace (for update command)' })),
  new_str: Type.Optional(Type.String({ description: 'Replacement string (for update command)' })),
})

export type ArtifactsParams = Static<typeof artifactsParamsSchema>

export function createArtifactsTool(options: {
  getArtifacts: () => Map<string, Artifact>
  setArtifacts: (artifacts: Map<string, Artifact>) => void
  setActiveArtifact: (filename: string | null) => void
  fs?: IFileSystem
}): AgentTool<typeof artifactsParamsSchema> {
  const fsPath = (filename: string) => `/home/user/${filename}`

  return {
    label: 'Artifacts',
    name: 'artifacts',
    description: ARTIFACTS_TOOL_DESCRIPTION,
    parameters: artifactsParamsSchema,
    execute: async (_toolCallId: string, args: ArtifactsParams) => {
      const artifacts = options.getArtifacts()
      const fs = options.fs

      switch (args.action) {
        case 'create': {
          if (!args.filename || !args.content) {
            return { content: [{ type: 'text', text: 'Error: create requires filename and content' }], details: undefined }
          }
          if (artifacts.has(args.filename)) {
            return { content: [{ type: 'text', text: `Error: File ${args.filename} already exists` }], details: undefined }
          }
          const artifact: Artifact = {
            filename: args.filename,
            content: args.content,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
          const newMap = new Map(artifacts)
          newMap.set(args.filename, artifact)
          options.setArtifacts(newMap)
          options.setActiveArtifact(args.filename)
          if (fs) {
            try { await fs.writeFile(fsPath(args.filename), args.content) } catch { /* ignore */ }
          }
          return { content: [{ type: 'text', text: `Created file ${args.filename}` }], details: undefined }
        }

        case 'update': {
          const existing = artifacts.get(args.filename)
          if (!existing) {
            const files = Array.from(artifacts.keys())
            return { content: [{ type: 'text', text: `Error: File ${args.filename} not found. Available: ${files.join(', ') || 'none'}` }], details: undefined }
          }
          if (!args.old_str || args.new_str === undefined) {
            return { content: [{ type: 'text', text: 'Error: update requires old_str and new_str' }], details: undefined }
          }
          let currentContent = existing.content
          if (fs) {
            try { currentContent = await fs.readFile(fsPath(args.filename)) } catch { /* ignore */ }
          }
          if (!currentContent.includes(args.old_str)) {
            return { content: [{ type: 'text', text: `Error: String not found in file. Content:\n\n${currentContent}` }], details: undefined }
          }
          const newContent = currentContent.replace(args.old_str, args.new_str)
          existing.content = newContent
          existing.updatedAt = new Date()
          const newMap = new Map(artifacts)
          newMap.set(args.filename, existing)
          options.setArtifacts(newMap)
          options.setActiveArtifact(args.filename)
          if (fs) {
            try { await fs.writeFile(fsPath(args.filename), newContent) } catch { /* ignore */ }
          }
          return { content: [{ type: 'text', text: `Updated file ${args.filename}` }], details: undefined }
        }

        case 'rewrite': {
          const existing = artifacts.get(args.filename)
          if (!existing) {
            const files = Array.from(artifacts.keys())
            return { content: [{ type: 'text', text: `Error: File ${args.filename} not found. Available: ${files.join(', ') || 'none'}` }], details: undefined }
          }
          if (!args.content) {
            return { content: [{ type: 'text', text: 'Error: rewrite requires content' }], details: undefined }
          }
          existing.content = args.content
          existing.updatedAt = new Date()
          const newMap = new Map(artifacts)
          newMap.set(args.filename, existing)
          options.setArtifacts(newMap)
          options.setActiveArtifact(args.filename)
          if (fs) {
            try { await fs.writeFile(fsPath(args.filename), args.content) } catch { /* ignore */ }
          }
          return { content: [{ type: 'text', text: `Rewrote file ${args.filename}` }], details: undefined }
        }

        case 'get': {
          if (fs) {
            try {
              const content = await fs.readFile(fsPath(args.filename))
              return { content: [{ type: 'text', text: content }], details: undefined }
            } catch { /* fall through */ }
          }
          const existing = artifacts.get(args.filename)
          if (!existing) {
            const files = Array.from(artifacts.keys())
            return { content: [{ type: 'text', text: `Error: File ${args.filename} not found. Available: ${files.join(', ') || 'none'}` }], details: undefined }
          }
          return { content: [{ type: 'text', text: existing.content }], details: undefined }
        }

        case 'delete': {
          if (!artifacts.has(args.filename)) {
            const files = Array.from(artifacts.keys())
            return { content: [{ type: 'text', text: `Error: File ${args.filename} not found. Available: ${files.join(', ') || 'none'}` }], details: undefined }
          }
          const newMap = new Map(artifacts)
          newMap.delete(args.filename)
          options.setArtifacts(newMap)
          if (fs) {
            try { await fs.rm(fsPath(args.filename)) } catch { /* ignore */ }
          }
          // Set active to first remaining or null
          const remaining = Array.from(newMap.keys())
          options.setActiveArtifact(remaining.length > 0 ? remaining[0] : null)
          return { content: [{ type: 'text', text: `Deleted file ${args.filename}` }], details: undefined }
        }

        default:
          return { content: [{ type: 'text', text: `Unknown action: ${(args as any).action}` }], details: undefined }
      }
    },
  }
}
