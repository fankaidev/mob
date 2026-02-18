-- D1 Schema for Chat Sessions
-- Each Durable Object uses this schema to persist its session data

-- Sessions table - stores session metadata
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'error'))
);

-- Messages table - stores conversation history
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'toolResult')),
  content TEXT NOT NULL,  -- JSON string of message content
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Index for efficient message queries
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id, created_at);

-- Files table - stores filesystem entries per session
-- Supports files, directories, and symlinks
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'file' CHECK(type IN ('file', 'dir', 'symlink')),
  content TEXT,           -- File content (NULL for directories)
  target TEXT,            -- Symlink target (NULL for files/dirs)
  mode INTEGER NOT NULL DEFAULT 420,  -- 0o644 = 420
  mtime INTEGER NOT NULL,
  UNIQUE(session_id, path),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Index for efficient file queries
CREATE INDEX IF NOT EXISTS idx_files_session_id ON files(session_id);
-- Index for directory listing (path prefix queries)
CREATE INDEX IF NOT EXISTS idx_files_path ON files(session_id, path);

-- Mounts table - stores git repository mounts per session
CREATE TABLE IF NOT EXISTS mounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  mount_path TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'git',
  config TEXT NOT NULL,  -- JSON: { url, ref?, depth?, token? }
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(session_id, mount_path),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Index for efficient mount queries
CREATE INDEX IF NOT EXISTS idx_mounts_session_id ON mounts(session_id);
