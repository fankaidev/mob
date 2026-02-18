/**
 * Entry point for just-bash in Cloudflare Workers backend.
 *
 * Excludes:
 * - OverlayFs / ReadWriteFs (requires node:fs)
 * - OpfsBackedFs (requires browser OPFS API)
 * - Sandbox (uses OverlayFs)
 *
 * Uses InMemoryFs for all filesystem operations.
 */

export type { BashLogger, BashOptions, ExecOptions } from "./Bash";
export { Bash } from "./Bash";
export type {
	AllCommandName,
	CommandName,
	NetworkCommandName,
} from "./commands/registry";
export {
	getCommandNames,
	getNetworkCommandNames,
} from "./commands/registry";
export type { CustomCommand, LazyCommand } from "./custom-commands";
export { defineCommand } from "./custom-commands";
export { InMemoryFs } from "./fs/in-memory-fs/index";
export type {
	BufferEncoding,
	CpOptions,
	DirectoryEntry,
	FileContent,
	FileEntry,
	FileInit,
	FileSystemFactory,
	FsEntry,
	FsStat,
	InitialFiles,
	MkdirOptions,
	RmOptions,
	SymlinkEntry,
} from "./fs/interface";
export type { NetworkConfig } from "./network/index";
export {
	NetworkAccessDeniedError,
	RedirectNotAllowedError,
	TooManyRedirectsError,
} from "./network/index";
export type {
	BashExecResult,
	Command,
	CommandContext,
	ExecResult,
	IFileSystem,
} from "./types";
