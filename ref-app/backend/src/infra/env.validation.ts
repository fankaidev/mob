import { z } from 'zod'

/**
 * Environment Variable Schema (Type Definitions Only)
 *
 * This schema is used for TypeScript type inference only.
 * No runtime validation is performed.
 *
 * PARAFLOW_* variables are system-level and cannot be customized by agents or users.
 * User-defined secrets (non-PARAFLOW_*) can be added via MCP tools.
 */

// ============================================================================
// Always Required
// ============================================================================
const alwaysRequiredSchema = z.object({
  // Sentry - Error tracking, issue debugging, event logging, stacktraces, performance monitoring
  PARAFLOW_SENTRY_DSN: z.string(),
  PARAFLOW_SENTRY_ENVIRONMENT: z.string(),
  PARAFLOW_SENTRY_RELEASE: z.string().optional(),
})

// ============================================================================
// Optional Features
// ============================================================================

// PostgreSQL database connection
const databaseSchema = z.object({
  PARAFLOW_DRIZZLE_URL: z.string().optional(),
})

// HTTP logging
const httpLoggingSchema = z.object({
  ENABLE_HTTP_LOG_DETAIL: z.string().optional(),
})

// User authentication service
const authSchema = z.object({
  PARAFLOW_APP_ID: z.string().optional(),
  PARAFLOW_AUTH_API_URL: z.string().optional(),
})

// AI capabilities (OpenAI-compatible API)
const aiGatewaySchema = z.object({
  PARAFLOW_AI_GATEWAY_TOKEN: z.string().optional(),
  PARAFLOW_AI_GATEWAY_OPENAI_BASE_URL: z.string().optional(),
})

// Object storage (R2)
const r2StorageSchema = z.object({
  PARAFLOW_R2_PROXY_DOMAIN: z.string().optional(),
  PARAFLOW_R2_TOKEN: z.string().optional(),
})

// Combine all PARAFLOW_ schemas
const paraflowEnvSchema = alwaysRequiredSchema
  .merge(databaseSchema)
  .merge(httpLoggingSchema)
  .merge(authSchema)
  .merge(aiGatewaySchema)
  .merge(r2StorageSchema)

// ============================================================================
// User-Defined Secrets
// ============================================================================
// Add user-defined secrets here (examples):
// - GOOGLE_CLIENT_ID: z.string().optional(),
// - GOOGLE_CLIENT_SECRET: z.string().optional(),
// - STRIPE_SECRET_KEY: z.string().optional(),
// - OPENAI_API_KEY: z.string().optional(),
const userSecretsSchema = z.object({
  AGENT_API_URL: z.string().optional(),
  AGENT_API_KEY: z.string().optional(),
  AGENT_API_MODEL: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
})

// ============================================================================
// Full Schema
// ============================================================================
export const envSchema = paraflowEnvSchema.merge(userSecretsSchema)

export type EnvConfig = z.infer<typeof envSchema>
