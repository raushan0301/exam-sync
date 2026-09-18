import type { ReactNode } from 'react';
import { cn } from './utils';

export interface FieldWrapperProps {
  id: string;
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Shared label-above / description / error-message chrome used by Input,
 * Textarea, Select, and (via FormField) any react-hook-form-controlled field.
 * Never uses placeholder-as-label (UX doc §1).
 */
export function FieldWrapper({
  id,
  label,
  description,
  error,
  required,
  children,
  className,
}: FieldWrapperProps) {
  const descId = description ? `${id}-description` : undefined;
  const errId = error ? `${id}-error` : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
          {required && (
            <span className="text-danger-text ml-0.5" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {description && (
        <p id={descId} className="text-xs text-text-subtle">
          {description}
        </p>
      )}
      {children}
      {error && (
        <p id={errId} role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

/** Builds the aria-describedby value combining description/error ids, or undefined. */
export function describedByIds(id: string, description?: string, error?: string): string | undefined {
  const ids = [description ? `${id}-description` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}
