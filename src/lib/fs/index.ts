/**
 * Filesystem abstractions for the agent environment.
 * Re-exports from just-bash fs module and adds git-fs support.
 */

// Re-export core filesystem interfaces and implementations from just-bash npm package
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
} from 'just-bash'

export { InMemoryFs, MountableFs, type MountConfig, type MountableFsOptions } from 'just-bash'
export { createGitFs } from './git-fs'
