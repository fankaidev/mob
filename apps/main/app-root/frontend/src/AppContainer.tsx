import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Toaster, toast } from '@/components/base/Toaster'
import { useTxomRouteInteceptor, HttpError, AuthRequiredError, ForbiddenError, FormError, NativeModalBlockedError } from 'txom-frontend-libs'
import { pageLinks } from './pageLinks'

function formatHttpErrorBody(body: string, status: number): string {
  if (!body) return `Error ${status}`
  try {
    const json = JSON.parse(body)
    // Handle zod validation error format: { success: false, error: { message: "[...issues JSON...]" } }
    if (json.error?.name === 'ZodError' && json.error.message) {
      try {
        const issues = JSON.parse(json.error.message)
        if (Array.isArray(issues)) {
          return issues
            .map((issue: { path?: (string | number)[]; message?: string }) => {
              const path = issue.path?.join('.') || ''
              return path ? `${path}: ${issue.message}` : issue.message
            })
            .join(', ')
        }
      } catch {
        // message is not JSON, return as-is
        return json.error.message
      }
    }
    // Handle zod validation error format (alternative): { error: { issues: [...] } }
    if (json.error?.issues && Array.isArray(json.error.issues)) {
      return json.error.issues
        .map((issue: { path?: (string | number)[]; message?: string }) => {
          const path = issue.path?.join('.') || ''
          return path ? `${path}: ${issue.message}` : issue.message
        })
        .join(', ')
    }
    // Handle simple { message: "..." } format
    if (json.message) return json.message
    // Fallback to raw body
    return body
  } catch {
    // Not JSON, return as-is
    return body
  }
}

function handleNativeModalError(error: NativeModalBlockedError) {
  if (!error.attemptedMessage) {
    return
  }
  switch (error.modalType) {
    case 'alert':
      toast.info(error.attemptedMessage)
      break
    case 'confirm':
      toast.warning(error.attemptedMessage)
      break
    case 'prompt':
      toast.info(error.attemptedMessage)
      break
  }
}

export function AppContainer() {
  useTxomRouteInteceptor()
  const navigate = useNavigate()

  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (event.reason instanceof NativeModalBlockedError) {
        handleNativeModalError(event.reason)
        return
      }
      // Authentication required - redirect to login
      // Use navigate in prototype mode to avoid page refresh (preserves PGLite data)
      // Use window.location.href in production for proper cookie handling
      if (event.reason instanceof AuthRequiredError) {
        navigate(pageLinks.global_shortcut_login())
        return
      }
      // Forbidden - show toast
      if (event.reason instanceof ForbiddenError) {
        toast.error('Access denied: You don\'t have permission for this action')
        return
      }
      // Form error - show toast
      if (event.reason instanceof FormError) {
        toast.error(event.reason.message)
        return
      }
      if (event.reason instanceof HttpError) {
        const status = event.reason.status
        if (status === 502) {
          toast.error('Preview is currently paused. Refresh to restart. It may take ~20 seconds.')
          return
        }
        if (status >= 400 && status < 500) {
          toast.error(formatHttpErrorBody(event.reason.body, status))
          return
        }
      }
      console.error('unhandledRejection', event)
      toast.error('Something went wrong')
    }

    const handleError = (event: ErrorEvent) => {
      if (event.error instanceof NativeModalBlockedError) {
        handleNativeModalError(event.error)
        event.preventDefault()
        return
      }
    }

    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    window.addEventListener('error', handleError)
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
      window.removeEventListener('error', handleError)
    }
  }, [navigate])

  return (
    <>
      <Outlet />
      <Toaster />
    </>
  )
}
