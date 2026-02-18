import { createBrowserRouter, RouteObject, RouterProvider } from "react-router-dom"
import { StrictMode } from "react"
import { type createStore, Provider } from "jotai"
import { createRoutes } from "./routes"


type Store = ReturnType<typeof createStore>

export function createApp(store: Store) {
  const routes = createRoutes(store)
  const router = createBrowserRouter(routes)

  // Error handling is done at route level via RouteErrorBoundary (see routes.ts errorElement)
  // This handles AuthRequiredError (401 -> login redirect) and ForbiddenError (403 -> Access Denied)
  return function App() {
    return (
      <StrictMode>
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      </StrictMode>
    )
  }
}
