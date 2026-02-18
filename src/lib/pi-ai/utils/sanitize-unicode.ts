/**
 * Backend copy of sanitize-unicode utility.
 * Copied from frontend/src/lib/pi-ai/src/utils/sanitize-unicode.ts
 */

export function sanitizeSurrogates(text: string): string {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}
