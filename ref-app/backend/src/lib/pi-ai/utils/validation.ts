import type { Tool, ToolCall } from "../types";

export function validateToolCall(tools: Tool[], toolCall: ToolCall): any {
	const tool = tools.find((t) => t.name === toolCall.name);
	if (!tool) {
		throw new Error(`Tool "${toolCall.name}" not found`);
	}
	return toolCall.arguments;
}

export function validateToolArguments(_tool: Tool, toolCall: ToolCall): any {
	return toolCall.arguments;
}
