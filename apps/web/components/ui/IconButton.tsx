'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './utils';
import type { ButtonVariant, ButtonSize } from './Button';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary-600 text-white border border-primary-600 hover:bg-primary-700',
  secondary: 'bg-surface text-text border border-border-strong hover:bg-neutral-50',
  tertiary: 'bg-transparent text-text-muted border border-transparent hover:bg-neutral-100',
  destructive: 'bg-danger-text text-white border border-danger-text hover:opacity-90',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-11 w-11',
  lg: 'h-12 w-12',
};

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  'aria-label': string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Icon-only button. `aria-label` is required (typed as non-optional) for a11y. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, variant = 'tertiary', size = 'md', disabled, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center rounded transition-colors duration-150 ease shrink-0',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        )}
        {...props}
      >
        {icon}
      </button>
    );
  },
);
IconButton.displayName = 'IconButton';
