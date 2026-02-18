/**
 * Backend copy of json-parse utility.
 * Copied from frontend/src/lib/pi-ai/src/utils/json-parse.ts
 */

import { parse as partialParse } from "partial-json";

export function parseStreamingJson<T = any>(partialJson: string | undefined): T {
	if (!partialJson || partialJson.trim() === "") {
		return {} as T;
	}

	try {
		return JSON.parse(partialJson) as T;
	} catch {
		try {
			const result = partialParse(partialJson);
			return (result ?? {}) as T;
		} catch {
			return {} as T;
		}
	}
}
