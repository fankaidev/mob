import { describe, it } from 'vitest'
import { vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { act } from 'react'
import * as helper from '@bdd-test/helper'
import { AuthRequiredError, HttpError, collectAllRoutePaths } from 'txom-frontend-libs'
import { createRoutes } from '@/routes'
import { createStore } from 'jotai'
import { createApp } from '@frontend/App'

async function renderRoute(url: string): Promise<void> {
  helper.cleanupRender()
  helper.store.reset()

  const rootEl = document.createElement('div')
  rootEl.id = 'bundler-root'
  document.body.appendChild(rootEl)

  window.history.pushState({}, '', url)

  const r = createRoot(rootEl)
  helper.setCurrentReactRoot(r)

  const flushPromises = () => new Promise(resolve => setImmediate(resolve))

  await act(async () => {
    const App = createApp(helper.store._internal)
    r.render(React.createElement(App))

    for (let i = 0; i < 30; i++) {
      await flushPromises()
      await vi.runAllTimersAsync()
    }
  })
}

// reference paraflow/demo/bdd-test/tests/store for more testing examples
describe('Smoke Test', () => {
  const allRoutes = collectAllRoutePaths(createRoutes(createStore()))

  for (const rawRoute of allRoutes) {
    if (rawRoute.includes('*') || rawRoute.includes(':')) {
      continue
    }
    const route = rawRoute
    if (route === null) {
      continue
    }

    it(`smoke test for route "${route}"`, async () => {
      try {
        await renderRoute(route)
      } catch(e) {
        if (e instanceof AuthRequiredError) {
          return // ignore
        }
        if (e instanceof HttpError && e.status === 404) {
          return // ignore
        }
        throw e
      }
    })
  }
})
