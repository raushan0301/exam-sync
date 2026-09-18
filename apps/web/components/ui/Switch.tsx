'use client';

import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from './utils';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  id?: string;
  label?: string;
}

/** Toggle switch built on a real checkbox input for native keyboard/a11y semantics. */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ id, label, className, disabled, ...props }, ref) => {
    const autoId = useId();
    const fieldId = id ?? autoId;

    return (
      <label
        htmlFor={fieldId}
        className={cn(
          'inline-flex items-center gap-2 min-h-[44px] cursor-pointer select-none',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full">
          <input
            ref={ref}
            id={fieldId}
            type="checkbox"
            role="switch"
            disabled={disabled}
            className={cn(
              'peer h-6 w-10 shrink-0 appearance-none rounded-full border border-border-strong bg-neutral-200 transition-colors duration-150 ease cursor-pointer',
              'checked:bg-primary-600 checked:border-primary-600',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed',
              className,
            )}
            {...props}
          />
          <span
            className={cn(
              'pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-white shadow-card transition-transform duration-150 ease',
              'peer-checked:translate-x-4',
            )}
          />
        </span>
        {label && <span className="text-base text-text">{label}</span>}
      </label>
    );
  },
);
Switch.displayName = 'Switch';
