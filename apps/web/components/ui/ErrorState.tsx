import { AlertOctagon } from 'lucide-react';
import { cn } from './utils';
import { Button } from './Button';

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

/** Icon + heading + description + Retry action — every plausibly-transient error gets a Retry. */
export function ErrorState({
  title = 'Something went wrong',
  description = 'Try again, or come back later if the problem persists.',
  onRetry,
  retrying = false,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2 py-12 text-center', className)}>
      <AlertOctagon className="mb-1 text-danger-text" size={28} aria-hidden="true" />
      <p className="text-base font-medium text-text">{title}</p>
      <p className="max-w-sm text-sm text-text-muted">{description}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      )}
    </div>
  );
}
