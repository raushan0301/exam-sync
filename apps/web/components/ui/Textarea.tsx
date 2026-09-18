'use client';

import { forwardRef, useId } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import { cn } from './utils';
import { FieldWrapper, describedByIds } from './FieldWrapper';

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  id?: string;
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    { id, label, description, error, required, className, containerClassName, disabled, readOnly, rows = 4, ...props },
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
        <textarea
          ref={ref}
          id={fieldId}
          rows={rows}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          aria-invalid={!!error || undefined}
          aria-describedby={describedByIds(fieldId, description, error)}
          className={cn(
            'w-full rounded border bg-surface px-3 py-2 text-base text-text transition-colors duration-150 ease resize-y',
            'placeholder:text-text-subtle',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            error ? 'border-danger-border' : 'border-border-strong',
            disabled && 'bg-neutral-100 text-text-subtle cursor-not-allowed',
            readOnly && !disabled && 'bg-neutral-50',
            className,
          )}
          {...props}
        />
      </FieldWrapper>
    );
  },
);
Textarea.displayName = 'Textarea';
