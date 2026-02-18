-- Audit Logs with Monthly Partitioning
-- This migration creates a partitioned audit_logs table and triggers for automatic auditing

-- 1. Create the partitioned audit_logs table
CREATE TABLE audit_logs (
  id BIGSERIAL,
  table_name VARCHAR(100) NOT NULL,
  record_id TEXT NOT NULL,
  action VARCHAR(20) NOT NULL,
  old_data JSONB,
  new_data JSONB,
  changed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  -- Trace fields - populated by triggers from session variables
  user_id TEXT,
  trace_id TEXT,
  PRIMARY KEY (id, changed_at)
) PARTITION BY RANGE (changed_at);

--> statement-breakpoint

-- 2. Create indexes on the partitioned table
CREATE INDEX audit_logs_table_name_idx ON audit_logs (table_name);
CREATE INDEX audit_logs_record_id_idx ON audit_logs (record_id);
CREATE INDEX audit_logs_changed_at_idx ON audit_logs (changed_at);
CREATE INDEX audit_logs_user_id_idx ON audit_logs (user_id);
CREATE INDEX audit_logs_trace_id_idx ON audit_logs (trace_id);

--> statement-breakpoint

-- 3. Create function to ensure partition exists (with retry on conflict)
CREATE OR REPLACE FUNCTION ensure_audit_partition(ts TIMESTAMPTZ)
RETURNS void AS $$
DECLARE
  start_date DATE;
  end_date DATE;
  partition_name TEXT;
BEGIN
  start_date := DATE_TRUNC('month', ts);
  end_date := start_date + INTERVAL '1 month';
  partition_name := 'audit_logs_' || TO_CHAR(start_date, 'YYYY_MM');

  -- Use exception handling instead of checking pg_class (faster)
  BEGIN
    EXECUTE FORMAT(
      'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      start_date,
      end_date
    );
  EXCEPTION
    WHEN duplicate_table THEN
      -- Partition already exists, ignore
      NULL;
  END;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- 4. BEFORE trigger function: auto-fill audit fields (for tables with all 4 audit columns)
CREATE OR REPLACE FUNCTION audit_before_trigger()
RETURNS TRIGGER AS $$
DECLARE
  current_ts TIMESTAMPTZ := NOW();
  current_user_id UUID;
BEGIN
  -- Get user_id from session variable (set by application middleware)
  BEGIN
    current_user_id := NULLIF(current_setting('app.user_id', true), '')::UUID;
  EXCEPTION WHEN OTHERS THEN
    current_user_id := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, current_ts);
    NEW.updated_at := current_ts;
    NEW.created_by := COALESCE(NEW.created_by, current_user_id);
    NEW.updated_by := COALESCE(NEW.updated_by, current_user_id);
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_at := current_ts;
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_by := COALESCE(current_user_id, NEW.updated_by);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- 4b. BEFORE trigger function for insert-only tables (only created_at, created_by)
CREATE OR REPLACE FUNCTION audit_before_insert_only_trigger()
RETURNS TRIGGER AS $$
DECLARE
  current_ts TIMESTAMPTZ := NOW();
  current_user_id UUID;
BEGIN
  BEGIN
    current_user_id := NULLIF(current_setting('app.user_id', true), '')::UUID;
  EXCEPTION WHEN OTHERS THEN
    current_user_id := NULL;
  END;

  NEW.created_at := COALESCE(NEW.created_at, current_ts);
  NEW.created_by := COALESCE(NEW.created_by, current_user_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- 5. AFTER trigger function: log changes to audit_logs table
CREATE OR REPLACE FUNCTION audit_after_trigger()
RETURNS TRIGGER AS $$
DECLARE
  current_ts TIMESTAMPTZ := NOW();
  current_user_id TEXT;
  current_trace_id TEXT;
  retry_count INT := 0;
BEGIN
  -- Get audit context from session variables (set by application middleware)
  current_user_id := NULLIF(current_setting('app.user_id', true), '');
  current_trace_id := NULLIF(current_setting('app.trace_id', true), '');

  LOOP
    BEGIN
      IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (table_name, record_id, action, old_data, changed_at, user_id, trace_id)
        VALUES (TG_TABLE_NAME, OLD.id::TEXT, 'DELETE', to_jsonb(OLD), current_ts, current_user_id, current_trace_id);
        RETURN OLD;
      ELSIF TG_OP = 'UPDATE' THEN
        -- Only log if data actually changed
        IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
          INSERT INTO audit_logs (table_name, record_id, action, old_data, new_data, changed_at, user_id, trace_id)
          VALUES (TG_TABLE_NAME, NEW.id::TEXT, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), current_ts, current_user_id, current_trace_id);
        END IF;
        RETURN NEW;
      ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (table_name, record_id, action, new_data, changed_at, user_id, trace_id)
        VALUES (TG_TABLE_NAME, NEW.id::TEXT, 'INSERT', to_jsonb(NEW), current_ts, current_user_id, current_trace_id);
        RETURN NEW;
      END IF;
      EXIT; -- Success, exit loop
    EXCEPTION
      WHEN check_violation THEN
        -- Partition doesn't exist, create it and retry
        IF retry_count < 1 THEN
          PERFORM ensure_audit_partition(current_ts);
          retry_count := retry_count + 1;
        ELSE
          RAISE;
        END IF;
    END;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- 6. Create initial partition for current month (ensures immediate functionality)
SELECT ensure_audit_partition(NOW());

--> statement-breakpoint

-- 7. Create helper function to create future partitions (run monthly via cron/scheduler)
CREATE OR REPLACE FUNCTION create_future_audit_partitions(months_ahead INTEGER DEFAULT 3)
RETURNS void AS $$
DECLARE
  start_date DATE;
  end_date DATE;
  partition_name TEXT;
BEGIN
  FOR i IN 0..months_ahead LOOP
    start_date := DATE_TRUNC('month', CURRENT_DATE + (i || ' months')::INTERVAL);
    end_date := start_date + INTERVAL '1 month';
    partition_name := 'audit_logs_' || TO_CHAR(start_date, 'YYYY_MM');

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = partition_name AND n.nspname = 'public'
    ) THEN
      EXECUTE FORMAT(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        start_date,
        end_date
      );
      RAISE NOTICE 'Created partition: %', partition_name;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- 8. Create helper function to drop old partitions (for data retention)
CREATE OR REPLACE FUNCTION drop_old_audit_partitions(months_to_keep INTEGER DEFAULT 12)
RETURNS void AS $$
DECLARE
  cutoff_date DATE;
  partition_record RECORD;
BEGIN
  cutoff_date := DATE_TRUNC('month', CURRENT_DATE - (months_to_keep || ' months')::INTERVAL);

  FOR partition_record IN
    SELECT c.relname as partition_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class parent ON parent.oid = i.inhparent
    WHERE parent.relname = 'audit_logs'
      AND n.nspname = 'public'
      AND c.relname < 'audit_logs_' || TO_CHAR(cutoff_date, 'YYYY_MM')
  LOOP
    EXECUTE FORMAT('DROP TABLE IF EXISTS %I', partition_record.partition_name);
    RAISE NOTICE 'Dropped partition: %', partition_record.partition_name;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
