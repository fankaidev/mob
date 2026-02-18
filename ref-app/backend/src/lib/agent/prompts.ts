export const BASH_TOOL_DESCRIPTION = `# Bash

Execute bash commands in a sandboxed environment with a virtual filesystem.

## When to Use
- File creation, manipulation, and inspection (echo, cat, grep, sed, awk, etc.)
- Directory operations (mkdir, ls, find, tree, etc.)
- Text processing and data transformation pipelines
- Running scripts and command sequences

## Environment
- Sandboxed in-browser bash with 90+ POSIX commands
- Virtual filesystem rooted at / with working directory /home/user
- Filesystem persists across tool calls within the session
- No network access, no system-level operations

## Available Commands
Core: echo, printf, cat, head, tail, tee, wc, sort, uniq, tr, cut, paste, rev, fold, expand, unexpand
Search: grep, find, xargs
Editors: sed, awk
Files: ls, cp, mv, rm, mkdir, rmdir, touch, chmod, ln, stat, file, du, df, realpath, basename, dirname
Text: diff, comm, join, column
Archive: tar
Other: date, env, export, set, unset, alias, test, expr, seq, yes, true, false, sleep, read, mapfile

## Shared Filesystem with Artifacts
- Bash and Artifacts share the same virtual filesystem at /home/user/
- Files created by the artifacts tool are directly accessible: \`cat report.html\`, \`wc -l report.html\`
- Files created by bash are readable via artifacts \`get\` command
- No need to manually copy or sync files between them

## Important Notes
- No network commands (curl, wget, etc.)
- No package managers or installers
- Environment variables do NOT persist across calls, but files DO persist
- Use \`echo "content" > file.txt\` to create files
- Use \`cat file.txt\` to read files
`

export const HTTP_REQUEST_TOOL_DESCRIPTION = `# HTTP Request

Make HTTP requests to external URLs and APIs.

## When to Use
- Fetching data from APIs (REST, GraphQL, etc.)
- Downloading web pages or resources
- Testing webhooks or endpoints
- Any task requiring network access

## Parameters
- url (required): The URL to request
- method (optional): GET, POST, PUT, PATCH, DELETE, HEAD (default: GET)
- headers (optional): Key-value pairs for request headers
- body (optional): Request body string (for POST/PUT/PATCH)

## Examples

### Simple GET
\`\`\`json
{ "url": "https://api.github.com/repos/denoland/deno" }
\`\`\`

### POST with JSON body
\`\`\`json
{
  "url": "https://httpbin.org/post",
  "method": "POST",
  "headers": { "Content-Type": "application/json" },
  "body": "{\\"key\\": \\"value\\"}"
}
\`\`\`

### With Authorization
\`\`\`json
{
  "url": "https://api.example.com/data",
  "headers": { "Authorization": "Bearer token123" }
}
\`\`\`

## Important Notes
- JSON responses are automatically pretty-printed
- Large responses (>50KB) are truncated
- Timeout: 30 seconds
- For processing response data, save it to a file with Bash/Artifacts and use Bash tools
`

export const ARTIFACTS_TOOL_DESCRIPTION = `# Artifacts

Create and manage persistent files that live alongside the conversation.

## When to Use - Artifacts Tool vs Bash

**Use artifacts tool when YOU are the author:**
- Writing research summaries, analysis, ideas, documentation
- Creating markdown notes for user to read
- Building HTML applications/visualizations that present data

**Use bash when CODE processes data:**
- Data transformation pipelines
- Text processing with standard POSIX tools

## Input
- { action: "create", filename: "notes.md", content: "..." } - Create new file
- { action: "update", filename: "notes.md", old_str: "...", new_str: "..." } - Update part of file (PREFERRED)
- { action: "rewrite", filename: "notes.md", content: "..." } - Replace entire file (LAST RESORT)
- { action: "get", filename: "data.json" } - Retrieve file content
- { action: "delete", filename: "old.csv" } - Delete file

## Supported File Types
✅ Text-based files: .md, .txt, .html, .js, .css, .json, .csv, .svg, .py, .ts, .tsx, .jsx, etc.

## Shared Filesystem with Bash
- Artifacts and Bash share the same virtual filesystem at /home/user/
- Files created here are directly accessible via bash commands
- Files created by bash are readable via artifacts \`get\` command

## Critical - Prefer Update Over Rewrite
❌ NEVER: get entire file + rewrite to change small sections
✅ ALWAYS: update for targeted edits (token efficient)

---

## HTML Artifacts

Interactive HTML applications rendered in a sandboxed iframe.

### Requirements
- Self-contained single file
- Import ES modules from esm.sh: <script type="module">import X from 'https://esm.sh/pkg';</script>
- Use Tailwind CDN: <script src="https://cdn.tailwindcss.com"></script>
- MUST set background color explicitly (avoid transparent)
- Inline CSS or Tailwind utility classes
- No localStorage/sessionStorage
`
