-- Migration: Add scheduled tasks support (simplified version)
-- Uses file-based configuration instead of database tables

-- Task execution history table
CREATE TABLE IF NOT EXISTS task_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,                -- Slack app ID
  task_file TEXT NOT NULL,             -- Command file path, e.g. "commands/daily-check.md"
  cron_expression TEXT NOT NULL,       -- Cron expression that triggered this execution

  -- Execution metadata
  started_at INTEGER NOT NULL,         -- Start time (milliseconds)
  finished_at INTEGER,                 -- End time (milliseconds)
  duration_ms INTEGER,                 -- Execution duration
  status TEXT NOT NULL CHECK(status IN ('success', 'error', 'timeout')),

  -- Execution details
  output TEXT,                         -- Agent output
  error_message TEXT,                  -- Error details if failed

  -- Context
  session_id TEXT,                     -- Session ID used for execution

  FOREIGN KEY (app_id) REFERENCES slack_apps(app_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_task_executions_app_id
  ON task_executions(app_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_executions_status
  ON task_executions(status);
CREATE INDEX IF NOT EXISTS idx_task_executions_started
  ON task_executions(started_at DESC);
