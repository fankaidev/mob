/**
 * Generate a session ID with the given prefix
 * Format: {prefix}-YYMMDDTHHmmssZ-{random}
 * @param prefix - The prefix for the session ID (e.g., 'web', 'slack')
 * @returns A unique session ID string
 */
export function generateSessionId(prefix: string): string {
  const now = new Date()
  const isoString = now.toISOString().replace(/[-:]/g, '').split('.')[0].slice(2, 15)
  const random = Math.random().toString(36).slice(2, 6)
  return `${prefix}-${isoString}-${random}`
}
