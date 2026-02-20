/**
 * Backend copy of pi-agent types.
 * Copied from frontend/src/lib/pi-agent/src/types.ts
 */

import type {
	AssistantMessageEvent,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	streamSimpleAnthropic,
	TextContent,
	Tool,
	ToolResultMessage,
} from "../pi-ai/index";
import type { Static, TSchema } from "@sinclair/typebox";

export type StreamFn = (
	...args: Parameters<typeof streamSimpleAnthropic>
) => ReturnType<typeof streamSimpleAnthropic> | Promise<ReturnType<typeof streamSimpleAnthropic>>;

export interface AgentLoopConfig extends SimpleStreamOptions {
	model: Model<any>;

	convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;

	getSteeringMessages?: () => Promise<AgentMessage[]>;

	getFollowUpMessages?: () => Promise<AgentMessage[]>;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface CustomAgentMessages {
	// Empty by default
}

// Extended message type with optional prefix for speaker identification
export type AgentMessage = (Message | CustomAgentMessages[keyof CustomAgentMessages]) & {
	prefix?: string  // Optional speaker prefix, e.g. "user:Kai" or "bot:AppName"
};

export interface AgentState {
	systemPrompt: string;
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	tools: AgentTool<any>[];
	messages: AgentMessage[];
	isStreaming: boolean;
	streamMessage: AgentMessage | null;
	pendingToolCalls: Set<string>;
	error?: string;
}

export interface AgentToolResult<T> {
	content: (TextContent | ImageContent)[];
	details: T;
}

export type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;

export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
	label: string;
	execute: (
		toolCallId: string,
		params: Static<TParameters>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TDetails>,
	) => Promise<AgentToolResult<TDetails>>;
}

export interface AgentContext {
	systemPrompt: string;
	messages: AgentMessage[];
	tools?: AgentTool<any>[];
}

export type AgentEvent =
	| { type: "agent_start" }
	| { type: "agent_end"; messages: AgentMessage[] }
	| { type: "turn_start" }
	| { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
	| { type: "message_start"; message: AgentMessage }
	| { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
	| { type: "message_end"; message: AgentMessage }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean };
