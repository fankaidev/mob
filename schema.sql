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
  content TEXT NOT NULL,  -- JSON string of message content (includes optional prefix field)
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

-- LLM configurations table - stores API configurations for different providers
CREATE TABLE IF NOT EXISTS llm_configs (
  name TEXT PRIMARY KEY,               -- Config name (e.g., "claude-sonnet", "gpt-4o")
  provider TEXT NOT NULL,              -- Provider: anthropic, openai, openrouter
  base_url TEXT NOT NULL,              -- API endpoint URL
  api_key TEXT NOT NULL,               -- API key (encrypted in production)
  model TEXT NOT NULL,                 -- Model ID
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Slack apps table - stores Slack app configurations
CREATE TABLE IF NOT EXISTS slack_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL UNIQUE,         -- Slack App ID (e.g., A0XXXXXXX)
  team_id TEXT,                        -- Slack Workspace ID
  app_name TEXT NOT NULL,              -- Display name (e.g., "Claude Bot")
  bot_token TEXT NOT NULL,             -- Bot token (xoxb-xxx)
  signing_secret TEXT NOT NULL,        -- Slack signing secret for request verification
  bot_user_id TEXT,                    -- Bot's Slack User ID (cached after first lookup)
  llm_config_name TEXT NOT NULL,       -- Associated LLM config name
  system_prompt TEXT,                  -- Optional: custom system prompt for this app
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (llm_config_name) REFERENCES llm_configs(name)
);

-- Index for efficient app lookups
CREATE INDEX IF NOT EXISTS idx_slack_apps_app_id ON slack_apps(app_id);

-- Slack thread mapping table - maps Slack threads to chat sessions
-- Note: Foreign keys removed to avoid timing issues with DO session creation
CREATE TABLE IF NOT EXISTS slack_thread_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_key TEXT NOT NULL UNIQUE,     -- Format: slack:{app_id}:{channel}:{thread_ts}
  session_id TEXT NOT NULL,            -- Associated chat session ID
  app_id TEXT NOT NULL,                -- Slack App ID that owns this thread
  channel TEXT NOT NULL,               -- Slack channel ID
  thread_ts TEXT,                      -- Thread timestamp (NULL for non-threaded)
  user_id TEXT,                        -- Slack user ID who started the thread
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Index for efficient thread lookups
CREATE INDEX IF NOT EXISTS idx_slack_thread_key ON slack_thread_mapping(thread_key);
CREATE INDEX IF NOT EXISTS idx_slack_thread_session ON slack_thread_mapping(session_id);

-- Slack users table - caches Slack user information
CREATE TABLE IF NOT EXISTS slack_users (
  user_id TEXT NOT NULL,                   -- Slack User ID (e.g., U0XXXXXXX)
  app_id TEXT NOT NULL,                    -- Slack App ID (for multi-workspace support)
  name TEXT NOT NULL,                      -- User's display name
  real_name TEXT,                          -- User's real name (optional)
  avatar_url TEXT,                         -- User's avatar URL (optional)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, app_id)
);

-- Index for efficient user lookups
CREATE INDEX IF NOT EXISTS idx_slack_users_lookup ON slack_users(app_id, user_id);
