import { type createStore } from 'jotai'
import { atom } from 'jotai'
import * as prototypeReactState from './prototypeReactState'
import { setupGlobalMethods$ } from './globalMethod'
import { NativeModalBlockedError } from './error'
import { RouteObject } from 'react-router-dom'
import { initSentry } from './client/sentryClient'

type Store = ReturnType<typeof createStore>

export interface prepareTxomParams {
  store: Store,
  routes: RouteObject[]
}


function setupRejectNativeModals() {
  if (!globalThis.window) {
    return
  }

  window.alert = function (message?: string) {
    throw new NativeModalBlockedError('alert', message)
  }

  window.confirm = function (message?: string): boolean {
    throw new NativeModalBlockedError('confirm', message)
  }

  window.prompt = function (message?: string, _defaultText?: string): string | null {
    throw new NativeModalBlockedError('prompt', message)
  }
}

const bootstrap$ = atom(null, async (get, set, opts: { _injected: unknown; routes: RouteObject[] }, signal: AbortSignal) => {
  if (opts._injected) {
    prototypeReactState.injectAllState(opts._injected)
  }

  setupRejectNativeModals()
  set(setupGlobalMethods$, opts.routes, signal)
})

const setupTxomGlobal = (store: Store, opts: {
  _injected: unknown
  routes: RouteObject[]
}) => {
  const rootController = new AbortController()
  store.set(bootstrap$, opts, rootController.signal)
}

export async function prepareTxom(params: prepareTxomParams) {
  const injected = (globalThis as any)._injected
  
  initSentry()

  const store = params.store
  setupTxomGlobal(store, {
    _injected: injected,
    routes: params.routes
  })
}
