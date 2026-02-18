/**
 * Browser-compatible entry point for just-bash.
 *
 * Excludes Node.js-specific modules:
 * - OverlayFs (requires node:fs)
 * - ReadWriteFs (requires node:fs)
 * - Sandbox (uses OverlayFs)
 *
 * Note: The gzip/gunzip/zcat commands will fail at runtime in browsers
 * since they use node:zlib. All other commands work.
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
export { OpfsBackedFs } from "./fs/opfs-backed-fs/index";
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
