'use client';

import { forwardRef, useId, createContext, useContext } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from './utils';

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  id?: string;
  label?: string;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(
  ({ id, label, className, disabled, name: nameProp, ...props }, ref) => {
    const autoId = useId();
    const fieldId = id ?? autoId;
    const groupCtx = useContext(RadioGroupContext);

    return (
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
            type="radio"
            name={nameProp ?? groupCtx?.name}
            disabled={disabled}
            className={cn(
              'peer h-5 w-5 shrink-0 appearance-none rounded-full border border-border-strong bg-surface transition-colors duration-150 ease',
              'checked:border-primary-600',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed',
              className,
            )}
            {...props}
          />
          <span className="pointer-events-none absolute h-2.5 w-2.5 rounded-full bg-primary-600 opacity-0 peer-checked:opacity-100" />
        </span>
        {label && <span className="text-base text-text">{label}</span>}
      </label>
    );
  },
);
Radio.displayName = 'Radio';

const RadioGroupContext = createContext<{ name: string } | null>(null);

export interface RadioGroupProps {
  name: string;
  label?: string;
  children: ReactNode;
  className?: string;
  orientation?: 'vertical' | 'horizontal';
}

/** Groups Radio children under one `name` and a shared, accessible `role="radiogroup"`. */
export function RadioGroup({ name, label, children, className, orientation = 'vertical' }: RadioGroupProps) {
  return (
    <RadioGroupContext.Provider value={{ name }}>
      <fieldset className={cn('flex flex-col gap-1.5 border-0 p-0 m-0', className)}>
        {label && <legend className="text-sm font-medium text-text mb-1">{label}</legend>}
        <div
          role="radiogroup"
          aria-label={label}
          className={cn('flex gap-3', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap')}
        >
          {children}
        </div>
      </fieldset>
    </RadioGroupContext.Provider>
  );
}
