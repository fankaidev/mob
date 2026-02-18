import { Type, type Static } from '@sinclair/typebox'
import type { AgentTool } from '../pi-agent/types'
import type { Bash } from 'just-bash'

// ============================================================================
// Read Tool
// ============================================================================
const readSchema = Type.Object({
  path: Type.String({
    description: 'Path to the file to read (e.g., "/tmp/hello.txt")'
  }),
})

export function createReadTool(getBash: () => Bash | null): AgentTool<typeof readSchema> {
  return {
    label: 'Read',
    name: 'read',
    description: 'Read the contents of a file from the filesystem.',
    parameters: readSchema,
    execute: async (_toolCallId: string, args: Static<typeof readSchema>, signal?: AbortSignal) => {
      if (signal?.aborted) {
        throw new Error('Execution aborted')
      }

      const bash = getBash()
      if (!bash) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: Bash instance not initialized. Please run a bash command first.'
          }],
          details: { error: 'Bash not initialized' }
        }
      }

      try {
        const content = await bash.readFile(args.path)
        return {
          content: [{
            type: 'text' as const,
            text: content
          }],
          details: { path: args.path, size: content.length }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{
            type: 'text' as const,
            text: `Error reading file: ${errorMessage}`
          }],
          details: { error: errorMessage, path: args.path }
        }
      }
    }
  }
}

// ============================================================================
// Write Tool
// ============================================================================
const writeSchema = Type.Object({
  path: Type.String({
    description: 'Path where the file should be written (e.g., "/tmp/hello.txt")'
  }),
  content: Type.String({
    description: 'Content to write to the file'
  }),
})

export function createWriteTool(
  getBash: () => Bash | null,
  onFilesChanged: () => Promise<void>
): AgentTool<typeof writeSchema> {
  return {
    label: 'Write',
    name: 'write',
    description: 'Write content to a file, creating it if it doesn\'t exist or overwriting if it does.',
    parameters: writeSchema,
    execute: async (_toolCallId: string, args: Static<typeof writeSchema>, signal?: AbortSignal) => {
      if (signal?.aborted) {
        throw new Error('Execution aborted')
      }

      const bash = getBash()
      if (!bash) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: Bash instance not initialized. Please run a bash command first.'
          }],
          details: { error: 'Bash not initialized' }
        }
      }

      try {
        await bash.writeFile(args.path, args.content)
        await onFilesChanged()

        return {
          content: [{
            type: 'text' as const,
            text: `Successfully wrote ${args.content.length} bytes to ${args.path}`
          }],
          details: { path: args.path, size: args.content.length }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{
            type: 'text' as const,
            text: `Error writing file: ${errorMessage}`
          }],
          details: { error: errorMessage, path: args.path }
        }
      }
    }
  }
}

// ============================================================================
// Edit Tool
// ============================================================================
const editSchema = Type.Object({
  path: Type.String({
    description: 'Path to the file to edit'
  }),
  oldText: Type.String({
    description: 'Text to search for and replace (must match exactly)'
  }),
  newText: Type.String({
    description: 'Text to replace with'
  }),
})

export function createEditTool(
  getBash: () => Bash | null,
  onFilesChanged: () => Promise<void>
): AgentTool<typeof editSchema> {
  return {
    label: 'Edit',
    name: 'edit',
    description: 'Edit a file by replacing a specific string with another string.',
    parameters: editSchema,
    execute: async (_toolCallId: string, args: Static<typeof editSchema>, signal?: AbortSignal) => {
      if (signal?.aborted) {
        throw new Error('Execution aborted')
      }

      const bash = getBash()
      if (!bash) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: Bash instance not initialized. Please run a bash command first.'
          }],
          details: { error: 'Bash not initialized' }
        }
      }

      try {
        // Read the file
        const content = await bash.readFile(args.path)

        // Check if old text exists
        if (!content.includes(args.oldText)) {
          return {
            content: [{
              type: 'text' as const,
              text: `Error: Could not find the text to replace in ${args.path}`
            }],
            details: { error: 'Text not found', path: args.path }
          }
        }

        // Replace the text
        const newContent = content.replace(args.oldText, args.newText)

        // Write back
        await bash.writeFile(args.path, newContent)
        await onFilesChanged()

        return {
          content: [{
            type: 'text' as const,
            text: `Successfully edited ${args.path}`
          }],
          details: {
            path: args.path,
            oldSize: content.length,
            newSize: newContent.length
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{
            type: 'text' as const,
            text: `Error editing file: ${errorMessage}`
          }],
          details: { error: errorMessage, path: args.path }
        }
      }
    }
  }
}

// ============================================================================
// List Tool
// ============================================================================
const listSchema = Type.Object({
  path: Type.Optional(Type.String({
    description: 'Path to list files from (defaults to /tmp)'
  })),
  recursive: Type.Optional(Type.Boolean({
    description: 'Whether to list files recursively (default: false)'
  })),
})

async function listFilesRecursive(bash: Bash, dirPath: string, prefix: string = ''): Promise<string[]> {
  const results: string[] = []

  try {
    const entries = await bash.fs.readdir(dirPath)

    for (const entry of entries) {
      if (entry === '.' || entry === '..') continue

      const fullPath = dirPath === '/' ? `/${entry}` : `${dirPath}/${entry}`
      const displayPath = prefix ? `${prefix}/${entry}` : entry

      try {
        const stat = await bash.fs.stat(fullPath)

        if (stat.isDirectory) {
          results.push(`${displayPath}/`)
          const subResults = await listFilesRecursive(bash, fullPath, displayPath)
          results.push(...subResults)
        } else {
          results.push(displayPath)
        }
      } catch (err) {
        results.push(`${displayPath} (error: ${err})`)
      }
    }
  } catch (err) {
    results.push(`Error reading directory: ${err}`)
  }

  return results
}

export function createListTool(getBash: () => Bash | null): AgentTool<typeof listSchema> {
  return {
    label: 'List',
    name: 'list',
    description: 'List files and directories in the filesystem.',
    parameters: listSchema,
    execute: async (_toolCallId: string, args: Static<typeof listSchema>, signal?: AbortSignal) => {
      if (signal?.aborted) {
        throw new Error('Execution aborted')
      }

      const bash = getBash()
      if (!bash) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: Bash instance not initialized. Please run a bash command first.'
          }],
          details: { error: 'Bash not initialized' }
        }
      }

      const dirPath = args.path || '/tmp'
      const recursive = args.recursive || false

      try {
        let files: string[]

        if (recursive) {
          files = await listFilesRecursive(bash, dirPath)
        } else {
          const entries = await bash.fs.readdir(dirPath)
          files = []

          for (const entry of entries) {
            if (entry === '.' || entry === '..') continue

            const fullPath = dirPath === '/' ? `/${entry}` : `${dirPath}/${entry}`

            try {
              const stat = await bash.fs.stat(fullPath)
              if (stat.isDirectory) {
                files.push(`${entry}/`)
              } else {
                files.push(entry)
              }
            } catch (err) {
              files.push(`${entry} (error)`)
            }
          }
        }

        const output = files.length > 0
          ? files.join('\n')
          : '(empty directory)'

        return {
          content: [{
            type: 'text' as const,
            text: output
          }],
          details: {
            path: dirPath,
            count: files.length,
            recursive
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{
            type: 'text' as const,
            text: `Error listing directory: ${errorMessage}`
          }],
          details: { error: errorMessage, path: dirPath }
        }
      }
    }
  }
}
