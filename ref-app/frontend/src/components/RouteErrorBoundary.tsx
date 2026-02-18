import { useRouteError, useNavigate } from 'react-router-dom'
import { AuthRequiredError, ForbiddenError, HttpError } from 'txom-frontend-libs'
import { pageLinks } from '../pageLinks'
import { useEffect } from 'react'

/**
 * Route-level error boundary for React Router.
 *
 * Handles authentication and authorization errors by:
 * - AuthRequiredError (401): Redirects to login page
 * - ForbiddenError (403): Shows access denied message
 * - Other errors: Shows generic error message
 */
export function RouteErrorBoundary() {
  const error = useRouteError()
  const navigate = useNavigate()

  useEffect(() => {
    if (error instanceof AuthRequiredError) {
      navigate(pageLinks.global_shortcut_login())
      return
    }
    console.error('RouteErrorBoundary', error)
  }, [navigate, error])

  if (error instanceof AuthRequiredError) {
    return null
  }

  if (import.meta.env.VITEST === 'true') {
    throw error
  }

  const ErrorContainer = ({ title, message, status }: { title: string; message: string; status?: string | number }) => (
    <div className="min-h-[80vh] flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center space-y-8">
        {status && (
          <div className="text-6xl text-neutral-200 select-none">
            {status}
          </div>
        )}

        <div className="space-y-2">
          <h1 className="text-lg text-neutral-900">{title}</h1>
          <p className="text-sm text-neutral-500">{message}</p>
        </div>

        <div className="h-px w-12 bg-neutral-200 mx-auto" />

        <a
          href={pageLinks.global_shortcut_home()}
          className="inline-block text-sm text-neutral-500 hover:text-neutral-900 underline"
        >
          Back to home
        </a>
      </div>
    </div>
  )

  if (error instanceof ForbiddenError) {
    return (
      <ErrorContainer
        title="Access Denied"
        message="You don't have permission to view this page."
        status={403}
      />
    )
  }

  if (error instanceof HttpError) {
    if (error.status === 502) {
      return (
        <ErrorContainer
          title="Preview is currently paused"
          message="Refresh to restart. It may take ~20 seconds."
          status={502}
        />
      )
    }

    if (error.isBusiness) {
      if (error.isNotFound) {
        return (
          <ErrorContainer
            title="Resource Not Found"
            message={error.body || "The resource you're looking for doesn't exist or has been removed."}
            status={404}
          />
        )
      }

      if (error.status > 400 && error.status < 500) {
        return (
          <ErrorContainer
            title="Oops!"
            message={error.body || "Something unexpected happened. Please try again."}
            status={error.status}
          />
        )
      }
    }

    return (
      <ErrorContainer
        title="Something went wrong"
        message="Our servers encountered an issue while processing your request. Please try again later."
        status={error.status}
      />
    )
  }

  return (
    <ErrorContainer
      title="Unexpected Error"
      message="An unexpected error occurred. We've been notified and are looking into it."
    />
  )
}
