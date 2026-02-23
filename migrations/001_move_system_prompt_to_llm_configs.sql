-- Migration: Move system_prompt from slack_apps to llm_configs
-- Date: 2024-02-24
-- Description: Migrates system_prompt field from slack_apps table to llm_configs table.
--              Since we assume each slack_app uses a different llm_config, we can directly
--              update the llm_config with the slack_app's system_prompt.
--
-- Note: BEGIN TRANSACTION and COMMIT removed for remote D1 compatibility

-- ============================================================================
-- Step 1: Add system_prompt field to llm_configs
-- ============================================================================
ALTER TABLE llm_configs ADD COLUMN system_prompt TEXT;

-- ============================================================================
-- Step 2: Migrate system_prompt from slack_apps to their llm_configs
-- ============================================================================

-- Update llm_configs with system_prompt from slack_apps
UPDATE llm_configs
SET system_prompt = (
  SELECT sa.system_prompt
  FROM slack_apps sa
  WHERE sa.llm_config_name = llm_configs.name
  AND sa.system_prompt IS NOT NULL
  AND sa.system_prompt != ''
  LIMIT 1
),
updated_at = strftime('%s', 'now') * 1000
WHERE name IN (
  SELECT llm_config_name
  FROM slack_apps
  WHERE system_prompt IS NOT NULL
  AND system_prompt != ''
);

-- ============================================================================
-- Step 3: Rebuild slack_apps table without system_prompt field
-- ============================================================================

-- Create new table without system_prompt
CREATE TABLE slack_apps_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL UNIQUE,
  team_id TEXT,
  app_name TEXT NOT NULL,
  bot_token TEXT NOT NULL,
  signing_secret TEXT NOT NULL,
  bot_user_id TEXT,
  llm_config_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (llm_config_name) REFERENCES llm_configs(name)
);

-- Copy data (excluding system_prompt)
INSERT INTO slack_apps_new (
  id, app_id, team_id, app_name, bot_token, signing_secret,
  bot_user_id, llm_config_name, created_at, updated_at
)
SELECT
  id, app_id, team_id, app_name, bot_token, signing_secret,
  bot_user_id, llm_config_name, created_at, updated_at
FROM slack_apps;

-- Replace old table with new one
DROP TABLE slack_apps;
ALTER TABLE slack_apps_new RENAME TO slack_apps;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_slack_apps_app_id ON slack_apps(app_id);

-- ============================================================================
-- Step 4: Add llm_config_name field to sessions table
-- ============================================================================
ALTER TABLE sessions ADD COLUMN llm_config_name TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_llm_config ON sessions(llm_config_name);

-- ============================================================================
-- Step 5: Verification
-- ============================================================================

-- Show migration summary
SELECT '=== Migration Summary ===' as info;

SELECT
  'Total LLM configs: ' || COUNT(*) as status
FROM llm_configs
UNION ALL
SELECT
  'LLM configs with system_prompt: ' || COUNT(*)
FROM llm_configs
WHERE system_prompt IS NOT NULL AND system_prompt != ''
UNION ALL
SELECT
  'Total Slack apps: ' || COUNT(*)
FROM slack_apps;

-- Show LLM configs with their system prompts
SELECT
  '=== LLM Configs with System Prompts ===' as info,
  name,
  model,
  CASE
    WHEN LENGTH(system_prompt) > 60 THEN SUBSTR(system_prompt, 1, 60) || '...'
    ELSE system_prompt
  END as prompt_preview
FROM llm_configs
WHERE system_prompt IS NOT NULL AND system_prompt != ''
ORDER BY name;
