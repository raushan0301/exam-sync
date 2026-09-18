import type { ReactNode } from 'react';
import { cn } from './utils';

export type BadgeColor = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const COLOR_CLASSES: Record<BadgeColor, string> = {
  success: 'bg-success-bg border-success-border text-success-text',
  warning: 'bg-warning-bg border-warning-border text-warning-text',
  danger: 'bg-danger-bg border-danger-border text-danger-text',
  info: 'bg-info-bg border-info-border text-info-text',
  neutral: 'bg-statusneutral-bg border-statusneutral-border text-statusneutral-text',
};

export interface BadgeProps {
  color?: BadgeColor;
  children: ReactNode;
  className?: string;
}

/** Generic colored pill — soft background + colored text, never solid-fill (UX doc §1). */
export function Badge({ color = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium leading-none',
        COLOR_CLASSES[color],
        className,
      )}
    >
      {children}
    </span>
  );
}
