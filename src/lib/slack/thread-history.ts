/**
 * Convert Slack thread messages to AgentMessage format
 */

import type { SlackMessage } from './types'
import type { AgentMessage } from '../pi-agent/types'

/**
 * Strip bot mention from message text
 * Removes <@UXXXXXXXX> patterns
 */
export function stripBotMention(text: string, botUserId?: string): string {
  if (botUserId) {
    // Remove specific bot mention
    text = text.replace(new RegExp(`<@${botUserId}>`, 'gi'), '')
  }
  // Remove all @mentions as fallback
  text = text.replace(/<@[A-Z0-9]+>/gi, '')
  return text.trim()
}

/**
 * Convert Slack messages to AgentMessage format
 * @param slackMessages - Messages from conversations.replies API
 * @param botUserId - Bot's Slack user ID to identify bot messages
 * @returns Array of AgentMessage objects
 */
export function convertSlackToAgentMessages(
  slackMessages: SlackMessage[],
  botUserId?: string
): AgentMessage[] {
  return slackMessages
    .filter((msg) => msg.type === 'message' && msg.text)
    .map((msg) => {
      // Determine if this is a bot message
      const isBot = msg.bot_id !== undefined || (botUserId && msg.user === botUserId)

      // Clean up the text
      let text = isBot ? msg.text : stripBotMention(msg.text, botUserId)

      // Skip empty messages after stripping mentions
      if (!text) {
        return null
      }

      // Prepend user name for user messages
      if (!isBot && msg.user_name) {
        text = `[user:${msg.user_name}] ${text}`
      }

      return {
        role: isBot ? 'assistant' : 'user',
        content: [{ type: 'text' as const, text }],
      } as AgentMessage
    })
    .filter((msg): msg is AgentMessage => msg !== null)
}

/**
 * Extract the user's latest message from a Slack event
 * Used when we receive an app_mention event
 */
export function extractUserMessage(eventText: string, botUserId?: string): string {
  return stripBotMention(eventText, botUserId)
}
