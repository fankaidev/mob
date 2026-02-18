-- Migration: 0002_agentfs
-- AgentFS PostgreSQL-backed Virtual Filesystem
-- Ported from https://github.com/tursodatabase/agentfs (SQLite → PostgreSQL)

-- Filesystem configuration
CREATE TABLE "fs_config" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL
);

-- Inode metadata (one row per file/directory/symlink)
CREATE TABLE "fs_inode" (
  "ino" serial PRIMARY KEY NOT NULL,
  "mode" integer NOT NULL,
  "nlink" integer NOT NULL DEFAULT 0,
  "uid" integer NOT NULL DEFAULT 0,
  "gid" integer NOT NULL DEFAULT 0,
  "size" bigint NOT NULL DEFAULT 0,
  "atime" bigint NOT NULL,
  "mtime" bigint NOT NULL,
  "ctime" bigint NOT NULL
);

-- Directory entries (parent + name → inode)
CREATE TABLE "fs_dentry" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "parent_ino" integer NOT NULL,
  "ino" integer NOT NULL,
  UNIQUE("parent_ino", "name")
);

--> statement-breakpoint
CREATE INDEX "idx_fs_dentry_parent" ON "fs_dentry" ("parent_ino", "name");

-- File content stored as chunked blobs
CREATE TABLE "fs_data" (
  "ino" integer NOT NULL,
  "chunk_index" integer NOT NULL,
  "data" bytea NOT NULL,
  PRIMARY KEY ("ino", "chunk_index")
);

--> statement-breakpoint
CREATE INDEX "idx_fs_data_ino_chunk" ON "fs_data" ("ino", "chunk_index");

-- Symbolic link targets
CREATE TABLE "fs_symlink" (
  "ino" integer PRIMARY KEY NOT NULL,
  "target" text NOT NULL
);

-- Key-value store
CREATE TABLE "kv_store" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

--> statement-breakpoint
CREATE INDEX "idx_kv_store_created_at" ON "kv_store" ("created_at");

-- Tool call audit log
CREATE TABLE "tool_calls" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "parameters" text,
  "result" text,
  "error" text,
  "status" text NOT NULL DEFAULT 'pending',
  "started_at" bigint NOT NULL,
  "completed_at" bigint,
  "duration_ms" integer
);

--> statement-breakpoint
CREATE INDEX "idx_tool_calls_name" ON "tool_calls" ("name");
--> statement-breakpoint
CREATE INDEX "idx_tool_calls_started_at" ON "tool_calls" ("started_at");

-- ============================================
-- Seed data: Initialize filesystem
-- ============================================

-- Config: chunk size = 4096 bytes, schema version = 0.4
INSERT INTO "fs_config" ("key", "value") VALUES ('chunk_size', '4096');
--> statement-breakpoint
INSERT INTO "fs_config" ("key", "value") VALUES ('schema_version', '0.4');

-- Root inode (ino=1, mode=0o040755 = 16877, directory with rwxr-xr-x)
INSERT INTO "fs_inode" ("ino", "mode", "nlink", "uid", "gid", "size", "atime", "mtime", "ctime")
VALUES (1, 16877, 5, 0, 0, 0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint);

-- Reset sequence after manual ino insert
SELECT setval('fs_inode_ino_seq', 100);

-- Create sample directories under root
-- /documents (ino=2)
INSERT INTO "fs_inode" ("ino", "mode", "nlink", "uid", "gid", "size", "atime", "mtime", "ctime")
VALUES (2, 16877, 2, 0, 0, 0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint);
--> statement-breakpoint
INSERT INTO "fs_dentry" ("name", "parent_ino", "ino") VALUES ('documents', 1, 2);

-- /images (ino=3)
INSERT INTO "fs_inode" ("ino", "mode", "nlink", "uid", "gid", "size", "atime", "mtime", "ctime")
VALUES (3, 16877, 2, 0, 0, 0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint);
--> statement-breakpoint
INSERT INTO "fs_dentry" ("name", "parent_ino", "ino") VALUES ('images', 1, 3);

-- /config (ino=4)
INSERT INTO "fs_inode" ("ino", "mode", "nlink", "uid", "gid", "size", "atime", "mtime", "ctime")
VALUES (4, 16877, 2, 0, 0, 0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint);
--> statement-breakpoint
INSERT INTO "fs_dentry" ("name", "parent_ino", "ino") VALUES ('config', 1, 4);

-- Create sample files
-- /documents/readme.txt (ino=5, mode=0o100644 = 33188, regular file rw-r--r--)
INSERT INTO "fs_inode" ("ino", "mode", "nlink", "uid", "gid", "size", "atime", "mtime", "ctime")
VALUES (5, 33188, 1, 0, 0, 47, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint);
--> statement-breakpoint
INSERT INTO "fs_dentry" ("name", "parent_ino", "ino") VALUES ('readme.txt', 2, 5);
--> statement-breakpoint
INSERT INTO "fs_data" ("ino", "chunk_index", "data") VALUES (5, 0, convert_to('Welcome to AgentFS powered by PostgreSQL!' || chr(10), 'UTF8'));

-- /documents/notes.md (ino=6)
INSERT INTO "fs_inode" ("ino", "mode", "nlink", "uid", "gid", "size", "atime", "mtime", "ctime")
VALUES (6, 33188, 1, 0, 0, 89, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint);
--> statement-breakpoint
INSERT INTO "fs_dentry" ("name", "parent_ino", "ino") VALUES ('notes.md', 2, 6);
--> statement-breakpoint
INSERT INTO "fs_data" ("ino", "chunk_index", "data") VALUES (6, 0, convert_to('# Notes' || chr(10) || chr(10) || 'This is a sample markdown file stored in the PostgreSQL-based filesystem.' || chr(10), 'UTF8'));

-- /config/settings.json (ino=7)
INSERT INTO "fs_inode" ("ino", "mode", "nlink", "uid", "gid", "size", "atime", "mtime", "ctime")
VALUES (7, 33188, 1, 0, 0, 78, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint);
--> statement-breakpoint
INSERT INTO "fs_dentry" ("name", "parent_ino", "ino") VALUES ('settings.json', 4, 7);
--> statement-breakpoint
INSERT INTO "fs_data" ("ino", "chunk_index", "data") VALUES (7, 0, convert_to('{"theme": "dark", "language": "en", "chunkSize": 4096, "version": "0.4"}' || chr(10), 'UTF8'));

-- /images/logo.svg (ino=8) - a simple SVG
INSERT INTO "fs_inode" ("ino", "mode", "nlink", "uid", "gid", "size", "atime", "mtime", "ctime")
VALUES (8, 33188, 1, 0, 0, 200, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint);
--> statement-breakpoint
INSERT INTO "fs_dentry" ("name", "parent_ino", "ino") VALUES ('logo.svg', 3, 8);
--> statement-breakpoint
INSERT INTO "fs_data" ("ino", "chunk_index", "data") VALUES (8, 0, convert_to('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#6366f1"/><text x="50" y="55" text-anchor="middle" fill="white" font-size="20">FS</text></svg>' || chr(10), 'UTF8'));

-- /hello.txt (ino=9) - a file in root
INSERT INTO "fs_inode" ("ino", "mode", "nlink", "uid", "gid", "size", "atime", "mtime", "ctime")
VALUES (9, 33188, 1, 0, 0, 26, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint);
--> statement-breakpoint
INSERT INTO "fs_dentry" ("name", "parent_ino", "ino") VALUES ('hello.txt', 1, 9);
--> statement-breakpoint
INSERT INTO "fs_data" ("ino", "chunk_index", "data") VALUES (9, 0, convert_to('Hello from AgentFS!' || chr(10), 'UTF8'));

-- Reset sequence to be safe
SELECT setval('fs_inode_ino_seq', (SELECT COALESCE(MAX(ino), 0) FROM fs_inode));

-- Seed KV store with sample data
INSERT INTO "kv_store" ("key", "value") VALUES ('agent:name', '"PostgreSQL Agent"');
--> statement-breakpoint
INSERT INTO "kv_store" ("key", "value") VALUES ('agent:version', '"1.0.0"');
--> statement-breakpoint
INSERT INTO "kv_store" ("key", "value") VALUES ('agent:config', '{"maxFiles": 1000, "maxFileSize": 10485760}');
