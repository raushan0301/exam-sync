'use client';

import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Check } from 'lucide-react';
import { cn } from './utils';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  id?: string;
  label?: string;
  error?: string;
}

/** Custom-styled checkbox over a real <input type="checkbox"> for full a11y/keyboard support. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ id, label, error, className, disabled, ...props }, ref) => {
    const autoId = useId();
    const fieldId = id ?? autoId;

    return (
      <div className="flex flex-col gap-1">
        <label
          htmlFor={fieldId}
          className={cn(
            'inline-flex items-center gap-2 min-h-[44px] cursor-pointer select-none',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
            <input
              ref={ref}
              id={fieldId}
              type="checkbox"
              disabled={disabled}
              aria-invalid={!!error || undefined}
              className={cn(
                'peer h-5 w-5 shrink-0 appearance-none rounded-sm border border-border-strong bg-surface transition-colors duration-150 ease',
                'checked:bg-primary-600 checked:border-primary-600',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed',
                className,
              )}
              {...props}
            />
            <Check
              size={14}
              strokeWidth={3}
              className="pointer-events-none absolute text-white opacity-0 peer-checked:opacity-100"
              aria-hidden="true"
            />
          </span>
          {label && <span className="text-base text-text">{label}</span>}
        </label>
        {error && (
          <p role="alert" className="text-xs text-danger-text">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Checkbox.displayName = 'Checkbox';
