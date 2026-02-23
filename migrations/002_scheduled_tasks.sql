-- Migration: Add scheduled tasks support (simplified version)
-- Uses file-based configuration instead of database tables
-- Architecture: Two-step scheduling and execution
--   Step 1: Cron Worker scans crons.txt and creates pending tasks
--   Step 2: TaskExecutor DO polls and executes pending tasks

-- Task execution table
CREATE TABLE IF NOT EXISTS task_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,                -- Slack app ID
  task_file TEXT NOT NULL,             -- Command file path, e.g. "commands/daily-check.md"
  cron_expression TEXT NOT NULL,       -- Cron expression that triggered this execution

  -- Scheduling metadata
  scheduled_at INTEGER NOT NULL,       -- Scheduled execution time (milliseconds, minute precision)

  -- Execution metadata
  started_at INTEGER,                  -- Actual start time (milliseconds)
  finished_at INTEGER,                 -- End time (milliseconds)
  duration_ms INTEGER,                 -- Execution duration
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'success', 'error', 'timeout')),

  -- Execution details
  output TEXT,                         -- Agent output
  error_message TEXT,                  -- Error details if failed

  -- Context
  session_id TEXT,                     -- Session ID used for execution

  FOREIGN KEY (app_id) REFERENCES slack_apps(app_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_task_executions_app_id
  ON task_executions(app_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_executions_status
  ON task_executions(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_task_executions_scheduled
  ON task_executions(scheduled_at DESC);

-- Unique index to prevent duplicate scheduling for the same task at the same minute
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_executions_dedup
  ON task_executions(app_id, task_file, scheduled_at);
