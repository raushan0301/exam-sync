'use client';

import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from './utils';
import { FieldWrapper, describedByIds } from './FieldWrapper';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id?: string;
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      id,
      label,
      description,
      error,
      required,
      leadingIcon,
      trailingIcon,
      className,
      containerClassName,
      disabled,
      readOnly,
      ...props
    },
    ref,
  ) => {
    const autoId = useId();
    const fieldId = id ?? autoId;

    return (
      <FieldWrapper
        id={fieldId}
        label={label}
        description={description}
        error={error}
        required={required}
        className={containerClassName}
      >
        <div className="relative flex items-center">
          {leadingIcon && (
            <span className="absolute left-3 text-text-subtle pointer-events-none flex items-center">
              {leadingIcon}
            </span>
          )}
          <input
            ref={ref}
            id={fieldId}
            disabled={disabled}
            readOnly={readOnly}
            required={required}
            aria-invalid={!!error || undefined}
            aria-describedby={describedByIds(fieldId, description, error)}
            className={cn(
              'h-11 w-full rounded border bg-surface px-3 text-base text-text transition-colors duration-150 ease',
              'placeholder:text-text-subtle',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              error ? 'border-danger-border' : 'border-border-strong',
              disabled && 'bg-neutral-100 text-text-subtle cursor-not-allowed',
              readOnly && !disabled && 'bg-neutral-50',
              leadingIcon && 'pl-9',
              trailingIcon && 'pr-9',
              className,
            )}
            {...props}
          />
          {trailingIcon && (
            <span className="absolute right-3 text-text-subtle pointer-events-none flex items-center">
              {trailingIcon}
            </span>
          )}
        </div>
      </FieldWrapper>
    );
  },
);
Input.displayName = 'Input';
