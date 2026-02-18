import { prepareTxom } from 'txom-frontend-libs'
import IS_FAST_PROTOTYPE_MODE from '@/IS_FAST_PROTOTYPE_MODE.json'
import { createRoutes } from './routes'
import { createStore } from 'jotai'
import { createApp } from './App'
import { createRoot } from 'react-dom/client'
import { createElement } from 'react'
import { resetQueryClient } from './queryClient'
import './styles/index.css'
import 'txom-frontend-libs/styles/index.css'

async function init() {
  const store = createStore()
  store.set(resetQueryClient)

  await prepareTxom({
    store,
    routes: createRoutes(store),
  })

  if (IS_FAST_PROTOTYPE_MODE) {
    const { initBrowserPrototype } = await import('./prototype/browserPrototype')
    await initBrowserPrototype()
  }

  const App = createApp(store)
  createRoot(document.getElementById('bundler-root')!).render(
    createElement(App),
  )
}
init()
