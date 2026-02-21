/**
 * Convert Slack thread messages to AgentMessage format
 */

import type { AgentMessage } from '../pi-agent/types'
import type { SlackClient } from './api'
import type { SlackMessage } from './types'

/**
 * Resolve user IDs to user names from Slack messages
 * Collects all <@USERID> mentions and message senders, returns a mapping of userId -> userName
 * @param messages - Slack messages to scan for user IDs
 * @param db - D1 database for caching
 * @param client - Slack client for API calls
 * @param appId - Slack app ID
 * @param getUserInfoFn - Function to get user info
 * @returns Map of userId to userName
 */
export async function resolveUserMentionsInMessages(
  messages: SlackMessage[],
  db: D1Database,
  client: SlackClient,
  appId: string,
  getUserInfoFn: (db: D1Database, client: SlackClient, appId: string, userId: string) => Promise<string>
): Promise<Map<string, string>> {
  const mentionRegex = /<@([A-Z0-9]+)>/g
  const allUserIds = new Set<string>()

  for (const msg of messages) {
    // Collect message sender IDs
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
 * Convert Slack user messages to AgentMessage format
 * Assumes all input messages are user messages (not bot messages)
 * Replaces user mentions and sets user prefix using the provided mapping
 * @param slackUserMessages - User messages from conversations.replies API
 * @param userIdToName - Mapping of userId to userName for mention replacement and prefix
 * @returns Array of AgentMessage objects
 */
export function convertSlackUserMessagesToAgentMessages(
  slackUserMessages: SlackMessage[],
  userIdToName: Map<string, string>
): AgentMessage[] {
  const mentionRegex = /<@([A-Z0-9]+)>/g

  return slackUserMessages
    .filter((msg) => msg.type === 'message' && msg.text?.trim())
    .map((msg) => {
      let text = msg.text.trim()

      // Replace user mentions with resolved names
      text = text.replace(mentionRegex, (match, userId) => {
        const userName = userIdToName.get(userId)
        return userName ? `@${userName}` : match
      })

      // Set user prefix from mapping (all messages are user messages)
      const userName = userIdToName.get(msg.user!)
      const prefix = userName ? `user:${userName}` : undefined

      // Create user message
      return {
        role: 'user' as const,
        content: [{ type: 'text' as const, text }],
        timestamp: Date.now(),
        prefix
      } as AgentMessage
    })
}

/**
 * Extract the user's latest message from a Slack event
 * Used when we receive an app_mention event
 * Removes the bot mention that triggered the event and resolves other user mentions
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

  // Remove the bot mention that triggered this event
  if (botUserId) {
    text = text.replace(new RegExp(`<@${botUserId}>`, 'gi'), '')
  }

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
