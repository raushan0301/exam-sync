'use client';

import { forwardRef, useId } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './utils';
import { FieldWrapper, describedByIds } from './FieldWrapper';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  id?: string;
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  options: SelectOption[];
  placeholder?: string;
  containerClassName?: string;
}

/** Native <select> wrapped for consistent styling — accessible by default. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      id,
      label,
      description,
      error,
      required,
      options,
      placeholder,
      className,
      containerClassName,
      disabled,
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
          <select
            ref={ref}
            id={fieldId}
            disabled={disabled}
            required={required}
            aria-invalid={!!error || undefined}
            aria-describedby={describedByIds(fieldId, description, error)}
            className={cn(
              'h-11 w-full appearance-none rounded border bg-surface pl-3 pr-9 text-base text-text transition-colors duration-150 ease',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              error ? 'border-danger-border' : 'border-border-strong',
              disabled && 'bg-neutral-100 text-text-subtle cursor-not-allowed',
              className,
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled hidden>
                {placeholder}
              </option>
            )}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="absolute right-3 text-text-subtle pointer-events-none"
            aria-hidden="true"
          />
        </div>
      </FieldWrapper>
    );
  },
);
Select.displayName = 'Select';
