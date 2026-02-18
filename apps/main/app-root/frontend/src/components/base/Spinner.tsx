import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {}

const Spinner = forwardRef<HTMLDivElement, SpinnerProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'size-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className
      )}
      {...props}
    />
  )
)
Spinner.displayName = 'Spinner'

export { Spinner }
