import { useNavigate } from 'react-router-dom'
import { pageLinks } from '../pageLinks'

function NotFoundPage() {
  const navigate = useNavigate()

  const handleGoHome = () => {
    navigate(pageLinks.global_shortcut_home())
  }

  const handleGoBack = () => {
    navigate(-1)
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-sm text-center">
        <div className="space-y-4 mb-8">
          <h1 className="text-6xl text-neutral-200 select-none">
            404
          </h1>
          <h2 className="text-xl text-neutral-900">
            Page Not Found
          </h2>
          <p className="text-sm text-neutral-500">
            The page you're looking for might have been moved,
            deleted, or never existed.
          </p>
        </div>

        <div className="h-px w-full bg-neutral-200 mb-8" />

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={handleGoHome}
            className="h-10 px-6 bg-neutral-900 text-white text-sm"
          >
            Go to Home
          </button>
          <button
            onClick={handleGoBack}
            className="h-10 px-6 bg-neutral-100 text-neutral-900 text-sm"
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  )
}

export default NotFoundPage
