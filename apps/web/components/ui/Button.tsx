'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './utils';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-600 text-white border border-primary-600 hover:bg-primary-700 hover:border-primary-700 active:bg-primary-800',
  secondary:
    'bg-surface text-text border border-border-strong hover:bg-neutral-50 active:bg-neutral-100',
  tertiary: 'bg-transparent text-text border border-transparent hover:bg-neutral-100 active:bg-neutral-200',
  destructive:
    'bg-danger-text text-white border border-danger-text hover:opacity-90 active:opacity-80',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 min-w-[44px]',
  md: 'h-11 px-4 text-base gap-2 min-w-[44px]', // 44px min touch target
  lg: 'h-12 px-5 text-lg gap-2 min-w-[44px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

/**
 * Base button primitive. Loading state keeps the button's rendered width
 * stable by hiding (not removing) the label via `invisible` and overlaying
 * a centered spinner, so triggering a loading state never reflows layout.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      leadingIcon,
      trailingIcon,
      disabled,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          'relative inline-flex items-center justify-center rounded font-medium transition-colors duration-150 ease',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="animate-spin" size={16} aria-hidden="true" />
          </span>
        )}
        <span className={cn('inline-flex items-center gap-2', loading && 'invisible')}>
          {leadingIcon}
          {children}
          {trailingIcon}
        </span>
      </button>
    );
  },
);
Button.displayName = 'Button';
