-- Remove system_prompt column from llm_configs table
-- SQLite doesn't support DROP COLUMN directly, so we need to recreate the table

-- Step 1: Disable foreign key constraints temporarily
PRAGMA foreign_keys = OFF;

-- Step 2: Create new table without system_prompt column
CREATE TABLE llm_configs_new (
  name TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Step 3: Copy data from old table to new table
INSERT INTO llm_configs_new (name, provider, base_url, api_key, model, created_at, updated_at)
SELECT name, provider, base_url, api_key, model, created_at, updated_at FROM llm_configs;

-- Step 4: Drop old table
DROP TABLE llm_configs;

-- Step 5: Rename new table to original name
ALTER TABLE llm_configs_new RENAME TO llm_configs;

-- Step 6: Re-enable foreign key constraints
PRAGMA foreign_keys = ON;
