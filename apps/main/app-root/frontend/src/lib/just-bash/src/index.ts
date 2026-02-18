export type { BashLogger, BashOptions, ExecOptions } from "./Bash";
export { Bash } from "./Bash";
export type {
	AllCommandName,
	CommandName,
	NetworkCommandName,
	PythonCommandName,
} from "./commands/registry";
export {
	getCommandNames,
	getNetworkCommandNames,
	getPythonCommandNames,
} from "./commands/registry";
// Custom commands API
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
export {
	MountableFs,
	type MountableFsOptions,
	type MountConfig,
} from "./fs/mountable-fs/index";
export type { NetworkConfig } from "./network/index";
export {
	NetworkAccessDeniedError,
	RedirectNotAllowedError,
	TooManyRedirectsError,
} from "./network/index";
// Security module - defense-in-depth
export type {
	DefenseInDepthConfig,
	DefenseInDepthHandle,
	DefenseInDepthStats,
	SecurityViolation,
	SecurityViolationType,
} from "./security/index";
export {
	createConsoleViolationCallback,
	DefenseInDepthBox,
	SecurityViolationError,
	SecurityViolationLogger,
} from "./security/index";
export type {
	BashExecResult,
	Command,
	CommandContext,
	ExecResult,
	IFileSystem,
} from "./types";
