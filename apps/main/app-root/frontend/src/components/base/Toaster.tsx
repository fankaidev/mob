import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
}

interface ToastContextValue {
  toasts: Toast[]
  addToast: (message: string, type: Toast['type']) => void
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let toastIdCounter = 0

// Global toast object for imperative API
export const toast = {
  info: (message: string) => globalAddToast?.(message, 'info'),
  success: (message: string) => globalAddToast?.(message, 'success'),
  warning: (message: string) => globalAddToast?.(message, 'warning'),
  error: (message: string) => globalAddToast?.(message, 'error'),
}

let globalAddToast: ((message: string, type: Toast['type']) => void) | null = null

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type: Toast['type']) => {
    const id = `toast-${++toastIdCounter}`
    setToasts((prev) => [...prev, { id, message, type }])

    // Auto-remove after 5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // Set global reference for imperative API
  globalAddToast = addToast

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  )
}

function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const typeStyles = {
    info: 'text-neutral-900',
    success: 'text-neutral-900',
    warning: 'text-neutral-900',
    error: 'text-red-600',
  }

  return (
    <div
      className={`relative flex items-center gap-3 px-4 py-3 bg-white border border-neutral-200 ${typeStyles[toast.type]}`}
    >
      <p className="text-sm flex-1">{toast.message}</p>
      <button
        onClick={onClose}
        className="shrink-0 p-1 text-neutral-400 hover:text-neutral-900"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function ToastContainer() {
  const { toasts, removeToast } = useToast()

  if (toasts.length === 0) return null

  return createPortal(
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onClose={() => removeToast(t.id)} />
        </div>
      ))}
    </div>,
    document.body
  )
}

export function Toaster() {
  return (
    <ToastProvider>
      <ToastContainer />
    </ToastProvider>
  )
}
