import { atom, type createStore } from 'jotai'
import { injectAllState, takeAllStateSnapshot } from './prototypeReactState'
import { collectAllRoutePaths } from './routesAnalysis'
import { globalNavigation } from './globalNavigation'
import { setAuthStateChangedHandler$ } from './globalAuth'
import { RouteObject } from 'react-router-dom'

type Store = ReturnType<typeof createStore>

export const setupGlobalMethods$ = atom(
  null,
  (get, set, routes: RouteObject[], signal: AbortSignal) => {
    signal.addEventListener('abort', () => {
      globalThis.takeStateSnapshot = undefined
      globalThis.injectStateSnapshot = undefined
      globalThis.getAllRoutePaths = undefined
      globalThis.changeRoutePath = undefined
      globalThis.onRouteChange = undefined
      globalThis.onAuthStateChanged = undefined
    })

    globalThis.takeStateSnapshot = async () => {
      const snapshot = await takeAllStateSnapshot()
      return snapshot
    }

    globalThis.injectStateSnapshot = (state: unknown) => {
      injectAllState(state)
    }

    globalThis.getAllRoutePaths = () => {
      return collectAllRoutePaths(routes)
    }

    globalThis.changeRoutePath = (path: string) => {
      const navigate = globalNavigation.navigate
      if (navigate) {
        navigate(path)
      } else {
        console.warn('globalNavigate not set up yet')
      }
    }

    globalThis.onRouteChange = (
      callback: (pathname: string) => void,
      signal: AbortSignal
    ) => {
      globalNavigation.globalRouteChangeCallback = callback

      signal.addEventListener('abort', () => {
        globalNavigation.globalRouteChangeCallback = null
      })
    }

    globalThis.onAuthStateChanged = (callback) => {
      set(setAuthStateChangedHandler$, callback)
    }
  }
)

// Note: globalNavigate$ and globalRouteChangeCallback$ are now exported from ./global-navigation
