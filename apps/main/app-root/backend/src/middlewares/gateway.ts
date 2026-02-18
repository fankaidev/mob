import { createMiddleware } from 'hono/factory'
import type { Env } from '../types/env'
import { productionGateways, type Gateways } from '../infra/gateway'

/**
 * Gateway middleware - injects gateway implementations into Hono context.
 *
 * In production, uses productionGateways.
 * In tests, call createGatewayMiddleware(testGateways) to inject test implementations.
 */
export function createGatewayMiddleware(gateways: Gateways = productionGateways) {
  return createMiddleware<Env>(async (c, next) => {
    c.set('gateways', gateways)
    await next()
  })
}

/**
 * Default gateway middleware using production implementations.
 */
export const gatewayMiddleware = createGatewayMiddleware()
