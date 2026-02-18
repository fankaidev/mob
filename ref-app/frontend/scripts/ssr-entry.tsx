/**
 * SSR Entry Point
 *
 * This file is built via `vite build --config vite.config.ssr.ts` and executed
 * directly by Node.js for prerendering. All dependencies are bundled.
 */

import { renderToString } from 'react-dom/server'
import { createElement, StrictMode } from 'react'
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router-dom'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { QueryClient } from '@tanstack/query-core'
import type { RouteObject } from 'react-router-dom'
import { createRoutes } from '../src/routes'

// Recursively strip all loaders and actions from routes (avoid API calls during SSR)
function stripLoaders(routes: RouteObject[]): RouteObject[] {
  return routes.map(route => ({
    ...route,
    loader: undefined,
    action: undefined,
    children: route.children ? stripLoaders(route.children) : undefined,
  }))
}

// Extract all static paths (without :params) from route tree
function extractStaticPaths(routes: RouteObject[], parentPath = ''): string[] {
  const paths = new Set<string>()

  for (const route of routes) {
    // Build full path - handle routes with or without path property
    let fullPath = parentPath

    if (route.path) {
      fullPath = route.path.startsWith('/')
        ? route.path
        : `${parentPath}/${route.path}`.replace(/\/+/g, '/')
    }

    // Normalize: ensure path starts with / and doesn't end with / (except root)
    if (fullPath && !fullPath.startsWith('/')) {
      fullPath = '/' + fullPath
    }
    if (fullPath.length > 1 && fullPath.endsWith('/')) {
      fullPath = fullPath.slice(0, -1)
    }

    // Add static paths (skip dynamic routes with :params and catch-all *)
    if (fullPath && !fullPath.includes(':') && !fullPath.includes('*')) {
      paths.add(fullPath)
    }

    // Recurse into children (even if current route has no path, e.g., layout routes)
    if (route.children) {
      for (const childPath of extractStaticPaths(route.children, fullPath)) {
        paths.add(childPath)
      }
    }
  }

  return Array.from(paths)
}

export interface PrerenderResult {
  url: string
  html: string
}

export async function getStaticPaths(): Promise<string[]> {
  const store = createStore()
  store.set(queryClientAtom, new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } }
  }))

  const routes = stripLoaders(createRoutes(store))
  return extractStaticPaths(routes)
}

export async function prerenderUrl(url: string): Promise<string> {
  const store = createStore()
  store.set(queryClientAtom, new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } }
  }))

  const routes = stripLoaders(createRoutes(store))
  const handler = createStaticHandler(routes)
  const request = new Request(`http://localhost${url}`)
  const context = await handler.query(request)

  if (context instanceof Response) {
    throw new Error(`Route ${url} returned a redirect`)
  }

  const router = createStaticRouter(handler.dataRoutes, context)
  return renderToString(
    createElement(StrictMode, null,
      createElement(Provider, { store },
        createElement(StaticRouterProvider, { router, context })
      )
    )
  )
}
