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
