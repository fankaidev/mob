-- Migration: 0004_migration
-- Third-party filesystem mounts (git repos, Notion, etc.)
-- Global mount list for agent virtual filesystem.

CREATE TABLE "fs_mounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mount_path" text NOT NULL,
  "type" text NOT NULL,
  "config" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fs_mounts_mount_path_unique" UNIQUE("mount_path")
);
