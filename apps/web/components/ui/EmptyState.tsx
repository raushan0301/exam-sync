import type { ReactNode } from 'react';
import { cn } from './utils';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Always includes a one-line explanation + optional direct action — never a bare "No data." */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2 py-12 text-center', className)}>
      {icon && <div className="mb-1 text-text-subtle">{icon}</div>}
      <p className="text-base font-medium text-text">{title}</p>
      {description && <p className="max-w-sm text-sm text-text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
