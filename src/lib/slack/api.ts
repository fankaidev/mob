/**
 * Slack API client
 */

import type {
  SlackMessage,
  ConversationsRepliesResponse,
  AuthTestResponse,
  ChatPostMessageResponse,
  UsersInfoResponse,
} from './types'

const SLACK_API_BASE = 'https://slack.com/api'

export class SlackClient {
  constructor(private botToken: string) {}

  /**
   * Post a message to a Slack channel
   */
  async postMessage(
    channel: string,
    text: string,
    threadTs?: string
  ): Promise<ChatPostMessageResponse> {
    const body: Record<string, string> = { channel, text }
    if (threadTs) {
      body.thread_ts = threadTs
    }

    const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    return response.json() as Promise<ChatPostMessageResponse>
  }

  /**
   * Update an existing message
   */
  async updateMessage(
    channel: string,
    ts: string,
    text: string
  ): Promise<ChatPostMessageResponse> {
    const response = await fetch(`${SLACK_API_BASE}/chat.update`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel, ts, text }),
    })

    return response.json() as Promise<ChatPostMessageResponse>
  }

  /**
   * Get all messages in a thread
   */
  async getThreadReplies(
    channel: string,
    threadTs: string,
    limit: number = 100
  ): Promise<SlackMessage[]> {
    const url = new URL(`${SLACK_API_BASE}/conversations.replies`)
    url.searchParams.set('channel', channel)
    url.searchParams.set('ts', threadTs)
    url.searchParams.set('limit', limit.toString())
    url.searchParams.set('inclusive', 'true') // Include parent message

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
      },
    })

    const data = (await response.json()) as ConversationsRepliesResponse
    return data.ok ? data.messages || [] : []
  }

  /**
   * Get the bot's user ID
   */
  async getBotUserId(): Promise<string | null> {
    const response = await fetch(`${SLACK_API_BASE}/auth.test`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        'Content-Type': 'application/json',
      },
    })

    const data = (await response.json()) as AuthTestResponse
    return data.ok ? data.user_id || null : null
  }

  /**
   * Get user information
   */
  async getUserInfo(userId: string): Promise<UsersInfoResponse> {
    const url = new URL(`${SLACK_API_BASE}/users.info`)
    url.searchParams.set('user', userId)

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
      },
    })

    return response.json() as Promise<UsersInfoResponse>
  }
}

/**
 * Split long text into multiple messages for Slack
 * Slack allows up to 4000 characters per message
 * @param text The text to split
 * @param maxLength Maximum length per message chunk (default: 3900 to leave room for metadata)
 * @returns Array of text chunks that fit within Slack's limits
 */
export function splitForSlack(text: string, maxLength: number = 3900): string[] {
  if (text.length <= maxLength) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    // Try to find a good break point (newline, space, or punctuation)
    let splitIndex = maxLength
    const searchStart = Math.max(0, maxLength - 200) // Look back up to 200 chars

    // Prioritize splitting at paragraph breaks
    const lastNewline = remaining.lastIndexOf('\n\n', maxLength)
    if (lastNewline > searchStart) {
      splitIndex = lastNewline + 2 // Include the newlines
    } else {
      // Try single newline
      const lastSingleNewline = remaining.lastIndexOf('\n', maxLength)
      if (lastSingleNewline > searchStart) {
        splitIndex = lastSingleNewline + 1
      } else {
        // Try period followed by space
        const lastPeriod = remaining.lastIndexOf('. ', maxLength)
        if (lastPeriod > searchStart) {
          splitIndex = lastPeriod + 2
        } else {
          // Try any space
          const lastSpace = remaining.lastIndexOf(' ', maxLength)
          if (lastSpace > searchStart) {
            splitIndex = lastSpace + 1
          }
          // Otherwise just hard cut at maxLength
        }
      }
    }

    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex)
  }

  return chunks
}

/**
 * @deprecated Use splitForSlack instead to send multiple messages
 * Truncate text to fit Slack's message limit
 * Slack allows up to 4000 characters per message
 */
export function truncateForSlack(text: string, maxLength: number = 3900): string {
  if (text.length <= maxLength) {
    return text
  }
  return text.slice(0, maxLength) + '\n\n_(response truncated)_'
}
