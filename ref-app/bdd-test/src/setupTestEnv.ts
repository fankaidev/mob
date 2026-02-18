/**
 * Test Environment Configuration
 *
 * Provides fake environment variables for testing.
 * These values are validated against the same schema used in production (backend/src/infra/env.validation.ts).
 * All URLs use .invalid domain (RFC 2606) to ensure they are unreachable.
 */

export function getTestEnv(): Record<string, string> {
  return {
    // Always Required
    PARAFLOW_SENTRY_DSN: 'https://fake-key@fake-sentry.invalid/999999',
    PARAFLOW_SENTRY_ENVIRONMENT: 'test',
    PARAFLOW_SENTRY_RELEASE: 'test-1.0.0-fake',

    // Optional Features
    PARAFLOW_DRIZZLE_URL: 'postgresql://fake-user:fake-pass@fake-host.invalid:5432/fake-db',
    PARAFLOW_APP_ID: 'test-fake-app-id',
    PARAFLOW_AUTH_API_URL: 'https://fake-auth.invalid',
    PARAFLOW_AI_GATEWAY_TOKEN: 'fake-ai-token-12345',
    PARAFLOW_AI_GATEWAY_OPENAI_BASE_URL: 'https://fake-ai-gateway.invalid',
    PARAFLOW_R2_PROXY_DOMAIN: 'https://fake-r2.invalid',
    PARAFLOW_R2_TOKEN: 'fake-r2-token-67890',
  }
}
