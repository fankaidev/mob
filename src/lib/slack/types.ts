/**
 * Slack integration types
 */

// Slack Event types
export interface SlackEvent {
  type: string
  user?: string
  channel?: string
  text?: string
  ts?: string
  thread_ts?: string
  bot_id?: string
  channel_type?: 'im' | 'channel' | 'group'
}

export interface SlackEventCallback {
  type: 'event_callback'
  api_app_id: string
  token: string
  team_id: string
  event: SlackEvent
  event_time: number
}

export interface SlackUrlVerification {
  type: 'url_verification'
  challenge: string
  token: string
}

export type SlackPayload = SlackEventCallback | SlackUrlVerification

// Slack Message from conversations.replies
export interface SlackMessage {
  type: string
  user?: string
  bot_id?: string
  text: string
  ts: string
  thread_ts?: string
  reply_count?: number
  reply_users_count?: number
}

export interface ConversationsRepliesResponse {
  ok: boolean
  messages?: SlackMessage[]
  error?: string
  has_more?: boolean
}

export interface AuthTestResponse {
  ok: boolean
  user_id?: string
  bot_id?: string
  error?: string
}

export interface ChatPostMessageResponse {
  ok: boolean
  ts?: string
  channel?: string
  error?: string
}

// Database model types
export interface LLMConfig {
  name: string
  provider: string
  base_url: string
  api_key: string
  model: string
  created_at: number
  updated_at: number
}

export interface SlackAppConfig {
  id: number
  app_id: string
  team_id: string | null
  app_name: string
  bot_token: string
  signing_secret: string
  bot_user_id: string | null
  llm_config_name: string
  system_prompt: string | null
  created_at: number
  updated_at: number
}

export interface SlackThreadMapping {
  id: number
  thread_key: string
  session_id: string
  app_id: string
  channel: string
  thread_ts: string | null
  user_id: string | null
  created_at: number
  updated_at: number
}
