// Command registry with statically analyzable lazy loading
// Each command has an explicit loader function for bundler compatibility (Next.js, etc.)

import type { Command, CommandContext, ExecResult } from "../types";

type CommandLoader = () => Promise<Command>;

interface LazyCommandDef<T extends string = string> {
	name: T;
	load: CommandLoader;
}

/** All available built-in command names (excludes network commands) */
export type CommandName =
	| "echo"
	| "cat"
	| "printf"
	| "ls"
	| "mkdir"
	| "rmdir"
	| "touch"
	| "rm"
	| "cp"
	| "mv"
	| "ln"
	| "chmod"
	| "pwd"
	| "readlink"
	| "head"
	| "tail"
	| "wc"
	| "stat"
	| "grep"
	| "fgrep"
	| "egrep"
	| "rg"
	| "sed"
	| "awk"
	| "sort"
	| "uniq"
	| "comm"
	| "cut"
	| "paste"
	| "tr"
	| "rev"
	| "nl"
	| "fold"
	| "expand"
	| "unexpand"
	| "strings"
	| "split"
	| "column"
	| "join"
	| "tee"
	| "find"
	| "basename"
	| "dirname"
	| "tree"
	| "du"
	| "env"
	| "printenv"
	| "alias"
	| "unalias"
	| "history"
	| "xargs"
	| "true"
	| "false"
	| "clear"
	| "bash"
	| "sh"
	| "jq"
	| "base64"
	| "diff"
	| "date"
	| "sleep"
	| "timeout"
	| "seq"
	| "expr"
	| "md5sum"
	| "sha1sum"
	| "sha256sum"
	| "file"
	| "help"
	| "which"
	| "tac"
	| "hostname"
	| "od"
	| "time"
	| "whoami";

/** Network command names (only available when network is configured) */
export type NetworkCommandName = "curl";

/** Python command names (only available when python is explicitly enabled) */
export type PythonCommandName = "python3" | "python";

/** All command names including network and python commands */
export type AllCommandName = CommandName | NetworkCommandName | PythonCommandName;

// Statically analyzable loaders - each import() call is a literal string
const commandLoaders: LazyCommandDef<CommandName>[] = [
	// Basic I/O
	{
		name: "echo",
		load: async () => (await import("./echo/echo")).echoCommand,
	},
	{
		name: "cat",
		load: async () => (await import("./cat/cat")).catCommand,
	},
	{
		name: "printf",
		load: async () => (await import("./printf/printf")).printfCommand,
	},

	// File operations
	{
		name: "ls",
		load: async () => (await import("./ls/ls")).lsCommand,
	},
	{
		name: "mkdir",
		load: async () => (await import("./mkdir/mkdir")).mkdirCommand,
	},
	{
		name: "rmdir",
		load: async () => (await import("./rmdir/rmdir")).rmdirCommand,
	},
	{
		name: "touch",
		load: async () => (await import("./touch/touch")).touchCommand,
	},
	{
		name: "rm",
		load: async () => (await import("./rm/rm")).rmCommand,
	},
	{
		name: "cp",
		load: async () => (await import("./cp/cp")).cpCommand,
	},
	{
		name: "mv",
		load: async () => (await import("./mv/mv")).mvCommand,
	},
	{
		name: "ln",
		load: async () => (await import("./ln/ln")).lnCommand,
	},
	{
		name: "chmod",
		load: async () => (await import("./chmod/chmod")).chmodCommand,
	},

	// Navigation
	{
		name: "pwd",
		load: async () => (await import("./pwd/pwd")).pwdCommand,
	},
	{
		name: "readlink",
		load: async () => (await import("./readlink/readlink")).readlinkCommand,
	},

	// File viewing
	{
		name: "head",
		load: async () => (await import("./head/head")).headCommand,
	},
	{
		name: "tail",
		load: async () => (await import("./tail/tail")).tailCommand,
	},
	{
		name: "wc",
		load: async () => (await import("./wc/wc")).wcCommand,
	},
	{
		name: "stat",
		load: async () => (await import("./stat/stat")).statCommand,
	},

	// Text processing
	{
		name: "grep",
		load: async () => (await import("./grep/grep")).grepCommand,
	},
	{
		name: "fgrep",
		load: async () => (await import("./grep/grep")).fgrepCommand,
	},
	{
		name: "egrep",
		load: async () => (await import("./grep/grep")).egrepCommand,
	},
	{
		name: "rg",
		load: async () => (await import("./rg/rg")).rgCommand,
	},
	{
		name: "sed",
		load: async () => (await import("./sed/sed")).sedCommand,
	},
	{
		name: "awk",
		load: async () => (await import("./awk/awk2")).awkCommand2,
	},
	{
		name: "sort",
		load: async () => (await import("./sort/sort")).sortCommand,
	},
	{
		name: "uniq",
		load: async () => (await import("./uniq/uniq")).uniqCommand,
	},
	{
		name: "comm",
		load: async () => (await import("./comm/comm")).commCommand,
	},
	{
		name: "cut",
		load: async () => (await import("./cut/cut")).cutCommand,
	},
	{
		name: "paste",
		load: async () => (await import("./paste/paste")).pasteCommand,
	},
	{
		name: "tr",
		load: async () => (await import("./tr/tr")).trCommand,
	},
	{
		name: "rev",
		load: async () => (await import("./rev/rev")).rev,
	},
	{
		name: "nl",
		load: async () => (await import("./nl/nl")).nl,
	},
	{
		name: "fold",
		load: async () => (await import("./fold/fold")).fold,
	},
	{
		name: "expand",
		load: async () => (await import("./expand/expand")).expand,
	},
	{
		name: "unexpand",
		load: async () => (await import("./expand/unexpand")).unexpand,
	},
	{
		name: "strings",
		load: async () => (await import("./strings/strings")).strings,
	},
	{
		name: "split",
		load: async () => (await import("./split/split")).split,
	},
	{
		name: "column",
		load: async () => (await import("./column/column")).column,
	},
	{
		name: "join",
		load: async () => (await import("./join/join")).join,
	},
	{
		name: "tee",
		load: async () => (await import("./tee/tee")).teeCommand,
	},

	// Search
	{
		name: "find",
		load: async () => (await import("./find/find")).findCommand,
	},

	// Path utilities
	{
		name: "basename",
		load: async () => (await import("./basename/basename")).basenameCommand,
	},
	{
		name: "dirname",
		load: async () => (await import("./dirname/dirname")).dirnameCommand,
	},

	// Directory utilities
	{
		name: "tree",
		load: async () => (await import("./tree/tree")).treeCommand,
	},
	{
		name: "du",
		load: async () => (await import("./du/du")).duCommand,
	},

	// Environment
	{
		name: "env",
		load: async () => (await import("./env/env")).envCommand,
	},
	{
		name: "printenv",
		load: async () => (await import("./env/env")).printenvCommand,
	},
	{
		name: "alias",
		load: async () => (await import("./alias/alias")).aliasCommand,
	},
	{
		name: "unalias",
		load: async () => (await import("./alias/alias")).unaliasCommand,
	},
	{
		name: "history",
		load: async () => (await import("./history/history")).historyCommand,
	},

	// Utilities
	{
		name: "xargs",
		load: async () => (await import("./xargs/xargs")).xargsCommand,
	},
	{
		name: "true",
		load: async () => (await import("./true/true")).trueCommand,
	},
	{
		name: "false",
		load: async () => (await import("./true/true")).falseCommand,
	},
	{
		name: "clear",
		load: async () => (await import("./clear/clear")).clearCommand,
	},

	// Shell
	{
		name: "bash",
		load: async () => (await import("./bash/bash")).bashCommand,
	},
	{
		name: "sh",
		load: async () => (await import("./bash/bash")).shCommand,
	},

	// Data processing
	{
		name: "jq",
		load: async () => (await import("./jq/jq")).jqCommand,
	},
	{
		name: "base64",
		load: async () => (await import("./base64/base64")).base64Command,
	},
	{
		name: "diff",
		load: async () => (await import("./diff/diff")).diffCommand,
	},
	{
		name: "date",
		load: async () => (await import("./date/date")).dateCommand,
	},
	{
		name: "sleep",
		load: async () => (await import("./sleep/sleep")).sleepCommand,
	},
	{
		name: "timeout",
		load: async () => (await import("./timeout/timeout")).timeoutCommand,
	},
	{
		name: "time",
		load: async () => (await import("./time/time")).timeCommand,
	},
	{
		name: "seq",
		load: async () => (await import("./seq/seq")).seqCommand,
	},
	{
		name: "expr",
		load: async () => (await import("./expr/expr")).exprCommand,
	},

	// Checksums
	{
		name: "md5sum",
		load: async () => (await import("./md5sum/md5sum")).md5sumCommand,
	},
	{
		name: "sha1sum",
		load: async () => (await import("./md5sum/sha1sum")).sha1sumCommand,
	},
	{
		name: "sha256sum",
		load: async () => (await import("./md5sum/sha256sum")).sha256sumCommand,
	},

	// File type detection
	{
		name: "file",
		load: async () => (await import("./file/file")).fileCommand,
	},

	// Help
	{
		name: "help",
		load: async () => (await import("./help/help")).helpCommand,
	},

	// PATH utilities
	{
		name: "which",
		load: async () => (await import("./which/which")).whichCommand,
	},

	// Misc utilities
	{
		name: "tac",
		load: async () => (await import("./tac/tac")).tac,
	},
	{
		name: "hostname",
		load: async () => (await import("./hostname/hostname")).hostname,
	},
	{
		name: "whoami",
		load: async () => (await import("./whoami/whoami")).whoami,
	},
	{
		name: "od",
		load: async () => (await import("./od/od")).od,
	},
];

// Python commands - not available in browser
const pythonCommandLoaders: LazyCommandDef<PythonCommandName>[] = [];

// Network commands - only registered when network is configured
const networkCommandLoaders: LazyCommandDef<NetworkCommandName>[] = [
	{
		name: "curl",
		load: async () => (await import("./curl/curl")).curlCommand,
	},
];

// Cache for loaded commands
const cache = new Map<string, Command>();

/**
 * Creates a lazy command that loads on first execution
 */
function createLazyCommand(def: LazyCommandDef): Command {
	return {
		name: def.name,
		async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
			let cmd = cache.get(def.name);

			if (!cmd) {
				cmd = await def.load();
				cache.set(def.name, cmd);
			}

			return cmd.execute(args, ctx);
		},
	};
}

/**
 * Gets all available command names (excludes network commands)
 */
export function getCommandNames(): string[] {
	return commandLoaders.map((def) => def.name);
}

/**
 * Gets all network command names
 */
export function getNetworkCommandNames(): string[] {
	return networkCommandLoaders.map((def) => def.name);
}

/**
 * Creates all lazy commands for registration (excludes network commands)
 * @param filter Optional array of command names to include. If not provided, all commands are created.
 */
export function createLazyCommands(filter?: CommandName[]): Command[] {
	const loaders = filter ? commandLoaders.filter((def) => filter.includes(def.name)) : commandLoaders;
	return loaders.map(createLazyCommand);
}

/**
 * Creates network commands for registration (curl, etc.)
 * These are only registered when network is explicitly configured.
 */
export function createNetworkCommands(): Command[] {
	return networkCommandLoaders.map(createLazyCommand);
}

/**
 * Gets all python command names
 */
export function getPythonCommandNames(): string[] {
	return pythonCommandLoaders.map((def) => def.name);
}

/**
 * Creates python commands for registration (python3, python).
 * These are only registered when python is explicitly enabled.
 * Note: Python introduces additional security surface (arbitrary code execution).
 */
export function createPythonCommands(): Command[] {
	return pythonCommandLoaders.map(createLazyCommand);
}

/**
 * Clears the command cache (for testing)
 */
export function clearCommandCache(): void {
	cache.clear();
}

/**
 * Gets the number of loaded commands (for testing)
 */
export function getLoadedCommandCount(): number {
	return cache.size;
}
