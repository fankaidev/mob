/// <reference types="vite/client" />

declare global {
  var takeStateSnapshot: (() => Promise<unknown>) | undefined
  var injectStateSnapshot: ((state: unknown) => void) | undefined
  var getAllRoutePaths: (() => string[]) | undefined
  var changeRoutePath: ((path: string) => void) | undefined
  var onRouteChange: ((callback: (pathname: string) => void, signal: AbortSignal) => void) | undefined
  var onAuthStateChanged: ((callback: () => void) => void) | undefined
}

export {}