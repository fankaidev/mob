/**
 * Convert Slack thread messages to AgentMessage format
 */

import type { AgentMessage } from '../pi-agent/types'
import type { SlackClient } from './api'
import type { SlackMessage } from './types'

/**
 * Resolve all user IDs (including bots) to names from Slack messages
 * Collects all <@USERID> mentions and message senders
 * Note: Bot messages have a user field (bot's user ID), so getUserInfo works for both users and bots
 * @param messages - Slack messages to scan for user IDs
 * @param db - D1 database for caching
 * @param client - Slack client for API calls
 * @param appId - Slack app ID
 * @param getUserInfoFn - Function to get user info (works for both users and bots)
 * @returns Map of userId to userName
 */
export async function resolveAllUserMentionsInMessages(
  messages: SlackMessage[],
  db: D1Database,
  client: SlackClient,
  appId: string,
  getUserInfoFn: (db: D1Database, client: SlackClient, appId: string, userId: string) => Promise<string>
): Promise<Map<string, string>> {
  const mentionRegex = /<@([A-Z0-9]+)>/g
  const allUserIds = new Set<string>()

  for (const msg of messages) {
    // Collect message sender IDs (includes bot user IDs)
    if (msg.user) {
      allUserIds.add(msg.user)
    }

    // Collect mentioned user IDs in text
    if (msg.text) {
      const matches = msg.text.matchAll(mentionRegex)
      for (const match of matches) {
        allUserIds.add(match[1])
      }
    }
  }

  // Resolve all user IDs to names in parallel
  const userIdToName = new Map<string, string>()
  if (allUserIds.size > 0) {
    const userIds = Array.from(allUserIds)
    const userNames = await Promise.all(
      userIds.map(userId => getUserInfoFn(db, client, appId, userId))
    )
    userIds.forEach((userId, index) => {
      userIdToName.set(userId, userNames[index])
    })
  }

  return userIdToName
}

/**
 * Convert Slack messages to AgentMessage format with bot differentiation
 * Converts messages based on whether they're from current bot, other bots, or users
 * @param slackMessages - Messages from conversations.replies API
 * @param currentBotUserId - Current bot's user ID
 * @param userIdToName - Mapping of userId to userName (includes bot names via their user IDs)
 * @returns Array of AgentMessage objects
 */
export function convertSlackMessagesToAgentMessages(
  slackMessages: SlackMessage[],
  currentBotUserId: string | null,
  userIdToName: Map<string, string>
): AgentMessage[] {
  const mentionRegex = /<@([A-Z0-9]+)>/g

  return slackMessages
    .filter((msg) => msg.type === 'message' && msg.text?.trim())
    .map((msg) => {
      let text = msg.text.trim()

      // Replace all mentions with resolved names
      text = text.replace(mentionRegex, (match, userId) => {
        const userName = userIdToName.get(userId)
        return userName ? `@${userName}` : match
      })

      // Determine if this is current bot's message
      const isCurrentBot = msg.user === currentBotUserId

      if (isCurrentBot) {
        // Current bot's message - assistant role
        return {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text }],
          timestamp: Date.now()
        } as AgentMessage
      } else if (msg.bot_id) {
        // Other bot's message - user role with bot prefix
        // Use the bot's user ID to get its name
        const botName = userIdToName.get(msg.user!) || msg.user || 'bot'
        return {
          role: 'user' as const,
          content: [{ type: 'text' as const, text }],
          timestamp: Date.now(),
          prefix: `bot:${botName}`
        } as AgentMessage
      } else {
        // Real user message
        const userName = userIdToName.get(msg.user!)
        const prefix = userName ? `user:${userName}` : undefined
        return {
          role: 'user' as const,
          content: [{ type: 'text' as const, text }],
          timestamp: Date.now(),
          prefix
        } as AgentMessage
      }
    })
}

/**
 * Extract the user's latest message from a Slack event
 * Used when we receive an app_mention event
 * Resolves user mentions and replaces them with the user's name
 * @param eventText - The event text containing potential user mentions
 * @param botUserId - Bot's user ID to remove from the text
 * @param db - D1 database for caching
 * @param client - Slack client for API calls
 * @param appId - Slack app ID
 * @param getUserInfoFn - Function to get user info
 * @returns Processed text with bot mention removed and user mentions resolved
 */
export async function extractUserMessage(
  eventText: string,
  botUserId: string | undefined,
  db: D1Database,
  client: SlackClient,
  appId: string,
  getUserInfoFn: (db: D1Database, client: SlackClient, appId: string, userId: string) => Promise<string>
): Promise<string> {
  let text = eventText
  console.log('eventText', eventText)

  // Find all user mentions (excluding the bot)
  const mentionRegex = /<@([A-Z0-9]+)>/g
  const matches = Array.from(text.matchAll(mentionRegex))

  if (matches.length > 0) {
    // Collect unique user IDs
    const userIds = [...new Set(matches.map(m => m[1]))]

    // Resolve all user IDs to names in parallel
    const userNames = await Promise.all(
      userIds.map(userId => getUserInfoFn(db, client, appId, userId))
    )

    // Create mapping
    const userIdToName = new Map<string, string>()
    userIds.forEach((userId, index) => {
      userIdToName.set(userId, userNames[index])
    })

    // Replace mentions with resolved names
    text = text.replace(mentionRegex, (match, userId) => {
      const userName = userIdToName.get(userId)
      return userName ? `@${userName}` : '@bot'
    })
  }

  console.log('user message text', text)

  return text.trim()
}
