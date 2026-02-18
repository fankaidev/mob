/**
 * Slack request signature verification
 * Uses HMAC-SHA256 to verify requests are from Slack
 */

const encoder = new TextEncoder()

/**
 * Verify Slack request signature
 * @param signingSecret - Slack app signing secret
 * @param signature - x-slack-signature header value
 * @param timestamp - x-slack-request-timestamp header value
 * @param body - Raw request body string
 * @returns true if signature is valid
 */
export async function verifySlackSignature(
  signingSecret: string,
  signature: string | undefined,
  timestamp: string | undefined,
  body: string
): Promise<boolean> {
  // Check required values exist
  if (!signature || !timestamp) {
    return false
  }

  // Reject requests older than 5 minutes (防重放攻击)
  const now = Math.floor(Date.now() / 1000)
  const requestTime = parseInt(timestamp, 10)
  if (isNaN(requestTime) || Math.abs(now - requestTime) > 60 * 5) {
    return false
  }

  // Build signature base string: v0:{timestamp}:{body}
  const sigBasestring = `v0:${timestamp}:${body}`

  // Generate HMAC-SHA256
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(sigBasestring))

  // Convert to hex string
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const expected = `v0=${hex}`

  // Constant-time comparison (防时序攻击)
  if (expected.length !== signature.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return result === 0
}
