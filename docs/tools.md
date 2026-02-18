# Agent Tools Documentation

This document describes the tools available to the AI agent for file operations and command execution.

## File Operation Tools

All file operations persist to D1 database and are available across conversations in the same session.

### Read Tool

Read the contents of a file.

**Parameters:**
- `path` (string): Path to the file (e.g., "/tmp/hello.txt")

**Example:**
```
Read the file at /tmp/data.txt
```

### Write Tool

Write content to a file, creating it if it doesn't exist or overwriting if it does.

**Parameters:**
- `path` (string): Path where the file should be written
- `content` (string): Content to write

**Example:**
```
Write "Hello World" to /tmp/hello.txt
```

### Edit Tool

Edit a file by replacing specific text.

**Parameters:**
- `path` (string): Path to the file to edit
- `oldText` (string): Text to search for (must match exactly)
- `newText` (string): Text to replace with

**Example:**
```
In /tmp/hello.txt, replace "Hello" with "Hi"
```

### List Tool

List files and directories.

**Parameters:**
- `path` (string, optional): Directory path (defaults to /tmp)
- `recursive` (boolean, optional): Whether to list recursively (default: false)

**Example:**
```
List all files in /tmp
List all files in /tmp recursively
```

## Bash Tool

Execute shell commands in an isolated environment with full Unix utilities support.

**Parameters:**
- `command` (string): Bash command to execute

**Available commands include:**
- File operations: cat, ls, cp, mv, rm, mkdir, touch, head, tail, grep, sed, awk, find
- Text processing: echo, printf, wc, sort, uniq, tr, cut
- System info: pwd, whoami, env

**Examples:**
```bash
# List files with details
ls -la

# View file content
cat README.md

# Search for text
grep "error" log.txt

# Pipe commands
cat data.txt | sort | uniq | wc -l

# Create directory
mkdir -p /tmp/myproject

# Process files
find /tmp -name "*.txt" -exec wc -l {} \;
```

## Tool Selection Guide

**When to use each tool:**

1. **Read** - When you need to view the entire contents of a single file
   - Simple and direct
   - Good for small to medium files
   - Returns full content

2. **Write** - When you need to create a new file or completely replace content
   - Creates parent directories automatically
   - Overwrites existing files
   - Best for programmatic file generation

3. **Edit** - When you need to make specific changes to existing files
   - Safe for targeted updates
   - Preserves rest of file content
   - Good for configuration changes

4. **List** - When you need to explore the filesystem
   - See what files exist
   - Check directory structure
   - Use recursive option for deep listing

5. **Bash** - When you need complex operations
   - Multiple operations in sequence
   - Piping and redirection
   - Text processing with grep, sed, awk
   - File manipulation with find, xargs
   - When other tools aren't sufficient

## Architecture

All tools share the same filesystem instance through a shared context:

1. `createFilesystemContext()` creates a shared bash instance and D1 persistence layer
2. All tools get access to the same bash filesystem via `getBash()`
3. File changes are automatically saved to D1 via `saveFiles()`
4. Files persist across conversations in the same session
5. Each session has isolated filesystem state

## File Persistence

Files are stored in the D1 database in the `files` table:

```sql
CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(session_id, path)
);
```

- Files are loaded when the bash instance is first initialized
- Files are saved after each tool execution that modifies the filesystem
- Files are isolated per session
- When a session is deleted, all associated files are deleted (CASCADE)
