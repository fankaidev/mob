
import { pgTable, text, timestamp, uuid, integer, pgEnum, jsonb, index, boolean, varchar, serial, bigint, customType } from 'drizzle-orm/pg-core'

// ============================================================================
// Chat / Agent Sessions (from 0001_migration)
// ============================================================================

export const agentSessionStatusEnum = pgEnum('agent_session_status', ['running', 'completed', 'error'])

export const agentSessions = pgTable('agent_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  message: text('message').notNull(),
  status: agentSessionStatusEnum('status').notNull().default('running'),
  response: text('response'),
  error: text('error'),
  usage: jsonb('usage'),
  eventCount: integer('event_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})

export const agentSessionEvents = pgTable('agent_session_events', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  data: jsonb('data'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('agent_session_events_session_id_idx').on(table.sessionId),
])

export type AgentSession = typeof agentSessions.$inferSelect
export type AgentSessionEvent = typeof agentSessionEvents.$inferSelect

// ============================================================================
// AgentFS - PostgreSQL-backed Virtual Filesystem (from 0002_agentfs)
// Ported from https://github.com/tursodatabase/agentfs (SQLite → PostgreSQL)
// ============================================================================

// Custom bytea type for file data chunks
// PGLite requires Uint8Array for bytea columns; Neon returns Buffer
const bytea = customType<{ data: Buffer; driverParam: Uint8Array }>({
  dataType() {
    return 'bytea'
  },
  toDriver(value: Buffer): Uint8Array {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  },
  fromDriver(value: unknown): Buffer {
    if (value instanceof Buffer) return value
    if (value instanceof Uint8Array) return Buffer.from(value)
    return Buffer.from(value as any)
  },
})

// Filesystem configuration (chunk_size, schema_version)
export const fsConfig = pgTable('fs_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

// Inode metadata (one row per file/directory/symlink)
export const fsInode = pgTable('fs_inode', {
  ino: serial('ino').primaryKey(),
  mode: integer('mode').notNull(),
  nlink: integer('nlink').notNull().default(0),
  uid: integer('uid').notNull().default(0),
  gid: integer('gid').notNull().default(0),
  size: bigint('size', { mode: 'number' }).notNull().default(0),
  atime: bigint('atime', { mode: 'number' }).notNull(),
  mtime: bigint('mtime', { mode: 'number' }).notNull(),
  ctime: bigint('ctime', { mode: 'number' }).notNull(),
})

// Directory entries (maps parent + name → inode)
export const fsDentry = pgTable('fs_dentry', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  parentIno: integer('parent_ino').notNull(),
  ino: integer('ino').notNull(),
}, (table) => [
  index('idx_fs_dentry_parent').on(table.parentIno, table.name),
])

// File content stored as chunked blobs
export const fsData = pgTable('fs_data', {
  ino: integer('ino').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  data: bytea('data').notNull(),
}, (table) => [
  index('idx_fs_data_ino_chunk').on(table.ino, table.chunkIndex),
])

// Symbolic link targets
export const fsSymlink = pgTable('fs_symlink', {
  ino: integer('ino').primaryKey(),
  target: text('target').notNull(),
})

// Key-value store for agent state
export const kvStore = pgTable('kv_store', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

// Tool call audit log
export const toolCalls = pgTable('tool_calls', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  parameters: text('parameters'),
  result: text('result'),
  error: text('error'),
  status: text('status').notNull().default('pending'),
  startedAt: bigint('started_at', { mode: 'number' }).notNull(),
  completedAt: bigint('completed_at', { mode: 'number' }),
  durationMs: integer('duration_ms'),
}, (table) => [
  index('idx_tool_calls_name').on(table.name),
  index('idx_tool_calls_started_at').on(table.startedAt),
])

// ============================================================================
// Third-party Filesystem Mounts (from 0003_fs_mounts)
// Global mount list — each row represents an external filesystem (git repo,
// Notion, etc.) that should be mounted into the agent's virtual filesystem.
// ============================================================================

export const fsMounts = pgTable('fs_mounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  mountPath: text('mount_path').notNull().unique(),
  type: text('type').notNull(), // "git", future: "notion", "gdrive", etc.
  config: jsonb('config').notNull(), // type-specific config, e.g. { url, ref, depth, token }
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type FsMount = typeof fsMounts.$inferSelect
export type FsMountInsert = typeof fsMounts.$inferInsert

// Type-specific config shapes
export interface GitMountConfig {
  url: string
  ref?: string
  depth?: number
  token?: string
}

// Type exports
export type FsConfig = typeof fsConfig.$inferSelect
export type FsInode = typeof fsInode.$inferSelect
export type FsDentry = typeof fsDentry.$inferSelect
export type FsData = typeof fsData.$inferSelect
export type FsSymlink = typeof fsSymlink.$inferSelect
export type KvStore = typeof kvStore.$inferSelect
export type ToolCall = typeof toolCalls.$inferSelect
