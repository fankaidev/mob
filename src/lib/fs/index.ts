/**
 * Filesystem abstractions for the agent environment.
 * Re-exports from just-bash fs module and adds git-fs support.
 */

// Re-export core filesystem interfaces and implementations
export type {
  IFileSystem,
  FsStat,
  FileContent,
  FsEntry,
  FileEntry,
  DirectoryEntry,
  SymlinkEntry,
  DirentEntry,
  BufferEncoding,
  ReadFileOptions,
  WriteFileOptions,
  MkdirOptions,
  RmOptions,
  CpOptions,
  InitialFiles,
  FileInit,
} from '../just-bash/src/fs/interface'

export { InMemoryFs } from '../just-bash/src/fs/in-memory-fs/in-memory-fs'
export { MountableFs, type MountConfig, type MountableFsOptions } from '../just-bash/src/fs/mountable-fs/mountable-fs'
export { createGitFs } from './git-fs'
