-- Migration: 0001_migration
-- Agent sessions and streaming events for Test Backend

CREATE TYPE "agent_session_status" AS ENUM ('running', 'completed', 'error');

--> statement-breakpoint

CREATE TABLE "agent_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "message" text NOT NULL,
  "status" "agent_session_status" NOT NULL DEFAULT 'running',
  "response" text,
  "error" text,
  "usage" jsonb,
  "event_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone
);

--> statement-breakpoint

CREATE TABLE "agent_session_events" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "session_id" uuid NOT NULL REFERENCES "agent_sessions"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "data" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX "agent_session_events_session_id_idx" ON "agent_session_events" ("session_id");
