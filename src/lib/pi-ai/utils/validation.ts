import type { Tool, ToolCall } from "../types";

export function validateToolArguments(_tool: Tool, toolCall: ToolCall): any {
	return toolCall.arguments;
}
