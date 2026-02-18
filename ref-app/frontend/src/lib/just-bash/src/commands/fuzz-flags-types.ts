/**
 * Type definitions for command fuzz flag metadata.
 */

export interface FuzzFlag {
	flag: string;
	type: "boolean" | "value";
	valueHint?: "number" | "path" | "string" | "pattern" | "format" | "delimiter";
}

export interface CommandFuzzInfo {
	name: string;
	flags: FuzzFlag[];
	stdinType?: "text" | "json" | "binary" | "none";
	needsFiles?: boolean;
	needsArgs?: boolean;
	minArgs?: number;
}
