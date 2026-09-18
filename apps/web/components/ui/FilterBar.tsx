import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from './utils';

export interface FilterBarProps {
  children: ReactNode;
  className?: string;
}

/** Container row for filter controls + chips above a table/list. */
export function FilterBar({ children, className }: FilterBarProps) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>;
}

export interface FilterChipProps {
  label: string;
  onRemove: () => void;
}

/** Removable filter chip — shows an active filter with a one-click clear. */
export function FilterChip({ label, onRemove }: FilterChipProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-primary-200 bg-primary-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-primary-800">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
        className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  );
}
