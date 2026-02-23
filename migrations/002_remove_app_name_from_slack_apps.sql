-- Migration: Remove app_name from slack_apps table
-- Date: 2024-02-24
-- Description: Remove app_name field since it duplicates llm_config_name.
--              We'll use llm_config_name as the identity for both Slack app and bot.
--
-- Note: No data migration needed as app_name values equal llm_config_name values

-- ============================================================================
-- Step 1: Rebuild slack_apps table without app_name
-- ============================================================================

-- Create new table without app_name and with unique llm_config_name
CREATE TABLE slack_apps_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL UNIQUE,
  team_id TEXT,
  bot_token TEXT NOT NULL,
  signing_secret TEXT NOT NULL,
  bot_user_id TEXT,
  llm_config_name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (llm_config_name) REFERENCES llm_configs(name)
);

-- Copy data (excluding app_name)
INSERT INTO slack_apps_new (
  id, app_id, team_id, bot_token, signing_secret,
  bot_user_id, llm_config_name, created_at, updated_at
)
SELECT
  id, app_id, team_id, bot_token, signing_secret,
  bot_user_id, llm_config_name, created_at, updated_at
FROM slack_apps;

-- Replace old table with new one
DROP TABLE slack_apps;
ALTER TABLE slack_apps_new RENAME TO slack_apps;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_slack_apps_app_id ON slack_apps(app_id);

-- ============================================================================
-- Step 2: Verification
-- ============================================================================

SELECT '=== Migration Summary ===' as info;

SELECT
  'Total Slack apps: ' || COUNT(*) as status
FROM slack_apps;

SELECT
  'Sample Slack apps:' as info,
  app_id,
  llm_config_name
FROM slack_apps
LIMIT 5;
