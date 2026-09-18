import { Loader2 } from 'lucide-react';
import { cn } from './utils';

export interface LoadingStateProps {
  label?: string;
  className?: string;
}

/** Centered spinner + label for full-section loading (not per-row/table skeletons — use Skeleton for those). */
export function LoadingState({ label = 'Loading…', className }: LoadingStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-12 text-text-muted', className)} role="status">
      <Loader2 className="animate-spin" size={24} aria-hidden="true" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
