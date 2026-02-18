import { clearApiProviders, registerApiProvider } from "../api-registry";
import { streamAnthropic, streamSimpleAnthropic } from "./anthropic";

export function registerBuiltInApiProviders(): void {
	registerApiProvider({
		api: "anthropic-messages",
		stream: streamAnthropic,
		streamSimple: streamSimpleAnthropic,
	});
}

export function resetApiProviders(): void {
	clearApiProviders();
	registerBuiltInApiProviders();
}
