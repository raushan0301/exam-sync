'use client';

import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from './utils';
import { FieldWrapper, describedByIds } from './FieldWrapper';

export interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  id?: string;
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
}

/** Native <input type="date"> wrapped consistently — no heavy datepicker lib. */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  ({ id, label, description, error, required, className, disabled, ...props }, ref) => {
    const autoId = useId();
    const fieldId = id ?? autoId;
    return (
      <FieldWrapper id={fieldId} label={label} description={description} error={error} required={required}>
        <input
          ref={ref}
          id={fieldId}
          type="date"
          disabled={disabled}
          required={required}
          aria-invalid={!!error || undefined}
          aria-describedby={describedByIds(fieldId, description, error)}
          className={cn(
            'h-11 w-full rounded border bg-surface px-3 text-base text-text transition-colors duration-150 ease',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            error ? 'border-danger-border' : 'border-border-strong',
            disabled && 'bg-neutral-100 text-text-subtle cursor-not-allowed',
            className,
          )}
          {...props}
        />
      </FieldWrapper>
    );
  },
);
DateInput.displayName = 'DateInput';

export interface DateRangeInputProps {
  startLabel?: string;
  endLabel?: string;
  start: string;
  end: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  className?: string;
}

/** Two native date inputs side by side for a date-range filter. */
export function DateRangeInput({
  startLabel = 'From',
  endLabel = 'To',
  start,
  end,
  onStartChange,
  onEndChange,
  className,
}: DateRangeInputProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-end', className)}>
      <DateInput label={startLabel} value={start} onChange={(e) => onStartChange(e.target.value)} max={end || undefined} />
      <DateInput label={endLabel} value={end} onChange={(e) => onEndChange(e.target.value)} min={start || undefined} />
    </div>
  );
}
