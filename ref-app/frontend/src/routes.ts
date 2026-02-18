
import { createElement } from 'react'
import type { RouteObject } from 'react-router-dom'
import type { createStore } from 'jotai'
import { AppContainer } from './AppContainer'
import { pageLinks } from './pageLinks'
import { RouteErrorBoundary } from './components/RouteErrorBoundary'
import NotFoundPage from './pages/NotFoundPage'
import ChatPage from './pages/function/Chat'
import * as ChatStore from './stores/ChatStore'
import FileExplorer from './pages/function/FileExplorer'
import * as FileExplorerStore from './stores/FileExplorerStore'

type Store = ReturnType<typeof createStore>

// ============================================================================
// ⚠️  CRITICAL: pageLinks ↔ createBusinessRoutes Contract
// ============================================================================
// 1. Define ALL page paths in `pageLinks.ts`
// 2. Use `pageLinks.xxx()` in `createBusinessRoutes` below (NOT hardcoded strings)
//
// This ensures:
// - Type-safe navigation throughout the app via `import { pageLinks } from './pageLinks'`
// - Single source of truth for all routes
// - Compile-time errors if routes are missing or mistyped
// ============================================================================

// TODO: add new pages here, replace the global_shortcut_home with real home page
//
// Route Registration Examples (see demoRoutes.ts for full examples):
//
// 1. Simple route (no params):
//    {
//      path: pageLinks.MyPage(),
//      element: createElement(MyPage),
//      loader: async () => {
//        await MyPageStore.loader(store)
//        return null
//      },
//    },
//
// 2. Route with path params (e.g., /items/:id):
//    {
//      path: pageLinks.ItemDetail(':id'),
//      element: createElement(ItemDetail),
//      loader: async ({ params }) => {
//        await ItemDetailStore.loader(store, params)
//        return null
//      },
//    },
//
// Auth is handled by backend API middlewares:
// - loginRequired  -> 401 -> redirect to login
// - adminRequired  -> 403 -> Access Denied page
// - publicAccessible / publicWithOptionalAuth -> no auth check
//
function createBusinessRoutes(store: Store): RouteObject[] {
  return [
    {
      path: pageLinks.Chat(),
      element: createElement(ChatPage),
      loader: async () => {
        await ChatStore.loader(store)
        return null
      },
    },
    {
      path: pageLinks.FileExplorer(),
      element: createElement(FileExplorer),
      loader: async () => {
        FileExplorerStore.loader(store)
        return null
      },
    },
  ]
}

// Fallback routes (must be last in children array)
function createFallbackRoutes(): RouteObject[] {
  const fallbackRoutes: RouteObject[] = []
  // 404 catch-all
  fallbackRoutes.push({
    path: '*',
    element: createElement(NotFoundPage),
  })
  return fallbackRoutes
}

export function createRoutes(store: Store): RouteObject[] {
  return [
    {
      path: '/',
      element: createElement(AppContainer),
      // Route-level error boundary handles AuthRequiredError, ForbiddenError, and other errors
      // This catches errors from loaders/actions that React Router intercepts before global ErrorBoundary
      errorElement: createElement(RouteErrorBoundary),


      children: [
        ...createBusinessRoutes(store),


        ...createFallbackRoutes(),
      ],
    },
  ]
}
