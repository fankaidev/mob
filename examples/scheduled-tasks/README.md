# Scheduled Tasks Examples

This directory contains example configuration files for scheduled tasks.

## Architecture

The scheduled task system uses a two-step architecture for reliability:

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Cron Worker (every minute)                         │
│  - Scans /work/apps/{app_name}/crons.txt for all apps       │
│  - Schedules tasks for the next 10 minutes                  │
│  - Deduplicates using unique constraint                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  task_executions table                                      │
│  status: pending → running → success/error/timeout          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: TaskExecutor DO (continuous polling)               │
│  - Queries pending tasks where scheduled_at <= now          │
│  - Executes tasks one by one (single instance)              │
│  - Updates status and records output                        │
└─────────────────────────────────────────────────────────────┘
```

**Benefits:**
- **No duplicate execution**: Unique constraint prevents scheduling the same task twice
- **No missed tasks**: Tasks are persisted in DB; TaskExecutor polls continuously
- **Observable**: Pending tasks visible before execution for debugging
- **Serial execution**: Single DO instance prevents resource contention

## Setup

1. **Copy files to your app directory:**
   ```bash
   # For an app named "my-bot"
   cp -r examples/scheduled-tasks /work/apps/my-bot/
   ```

2. **Edit `crons.txt`:**
   - Adjust cron expressions to your desired schedule
   - Update file paths if you rename/move command files

3. **Customize command files:**
   - Edit markdown files in `commands/` directory
   - Add front matter for Slack integration (optional):
     ```markdown
     ---
     channel: C1234567890
     thread_ts: 1234567890.123456
     ---

     Your command prompt here...
     ```

## Cron Expression Format

Standard 5-field cron format:
```
* * * * *
│ │ │ │ │
│ │ │ │ └── Day of week (0-7, Sunday = 0 or 7)
│ │ │ └──── Month (1-12)
│ │ └────── Day of month (1-31)
│ └──────── Hour (0-23)
└────────── Minute (0-59)
```

### Examples

| Expression | Description |
|------------|-------------|
| `*/5 * * * *` | Every 5 minutes |
| `*/10 * * * *` | Every 10 minutes |
| `*/30 * * * *` | Every 30 minutes |
| `0 * * * *` | Every hour (at minute 0) |
| `0 */6 * * *` | Every 6 hours |
| `0 9 * * *` | Every day at 9:00 AM |
| `0 9 * * 1-5` | Every weekday at 9:00 AM |
| `0 0 * * 0` | Every Sunday at midnight |
| `30 14 1 * *` | 2:30 PM on the 1st of every month |

## File Structure

```
/work/apps/{app_name}/
├── crons.txt                   # Cron schedule configuration
└── commands/
    ├── code-check.md           # Periodic code quality checks
    ├── morning-report.md       # Daily morning report
    └── your-custom-task.md     # Your custom commands
```

## Command File Format

### Simple Format (No Front Matter)

```markdown
Check the system status and report any issues.
```

### With Front Matter (Slack Integration)

```markdown
---
channel: C1234567890
thread_ts: 1234567890.123456
---

Your command prompt here...
```

**Front Matter Options:**
- `channel` (optional): Slack channel ID to post results
- `thread_ts` (optional): Slack thread timestamp to reply in a specific thread

## Testing

### Manual Testing via Agent

You can test your commands by directly asking the agent to execute them:

```
Read and execute the command in /work/apps/my-bot/commands/code-check.md
```

### Check Execution History

Query the database to see execution history:

```sql
-- View recent executions
SELECT id, task_file, status, scheduled_at, started_at, duration_ms
FROM task_executions
WHERE app_id = 'YOUR_APP_ID'
ORDER BY scheduled_at DESC
LIMIT 10;

-- View pending tasks (not yet executed)
SELECT * FROM task_executions
WHERE status = 'pending'
ORDER BY scheduled_at ASC;
```

## Troubleshooting

### Task Not Running

1. **Check crons.txt exists:**
   ```
   !ls -la /work/apps/{app_name}/crons.txt
   ```

2. **Verify cron expression:**
   - Use https://crontab.guru/ to test expressions
   - Remember: format is 5 fields (minute hour day month weekday)

3. **Check command file exists:**
   ```
   !ls -la /work/apps/{app_name}/commands/
   ```

4. **View execution logs:**
   - Check Cloudflare Workers logs
   - Look for `[Cron]` prefixed messages

### Task Failing

Check `task_executions` table for error messages:

```sql
SELECT task_file, error_message, started_at
FROM task_executions
WHERE status = 'error'
ORDER BY started_at DESC
LIMIT 5;
```

## Best Practices

1. **Start with longer intervals:** Test with hourly tasks before using minute-level schedules
2. **Use descriptive file names:** `daily-backup.md` is better than `task1.md`
3. **Keep commands focused:** One clear task per command file
4. **Monitor execution:** Regularly check `task_executions` table
5. **Test commands manually first:** Use the agent to test before scheduling
6. **Consider timezone:** Cron times are in UTC by default

## Advanced Usage

### Sequential Tasks

Create commands that depend on each other:

```markdown
---
channel: C1234567890
---

1. Run the data processing script
2. Wait for completion
3. Generate the summary report
4. Send notifications if there are any issues
```

### Conditional Execution

Use Agent's reasoning capabilities:

```markdown
Check if there are any new commits since yesterday.
If there are new commits, analyze them for security issues.
Only report if you find actual issues.
```

### Multiple Apps

Each app has its own independent schedule:

```
/work/apps/production-bot/crons.txt    # Production schedules
/work/apps/staging-bot/crons.txt       # Staging schedules
/work/apps/dev-bot/crons.txt           # Dev schedules
```
