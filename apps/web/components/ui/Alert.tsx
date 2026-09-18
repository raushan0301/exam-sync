'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, AlertOctagon, Info, X } from 'lucide-react';
import { cn } from './utils';
import { IconButton } from './IconButton';

export type AlertColor = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const COLOR_CLASSES: Record<AlertColor, string> = {
  success: 'bg-success-bg border-success-border text-success-text',
  warning: 'bg-warning-bg border-warning-border text-warning-text',
  danger: 'bg-danger-bg border-danger-border text-danger-text',
  info: 'bg-info-bg border-info-border text-info-text',
  neutral: 'bg-statusneutral-bg border-statusneutral-border text-statusneutral-text',
};

const ICONS: Record<AlertColor, ReactNode> = {
  success: <CheckCircle2 size={18} aria-hidden="true" />,
  warning: <AlertTriangle size={18} aria-hidden="true" />,
  danger: <AlertOctagon size={18} aria-hidden="true" />,
  info: <Info size={18} aria-hidden="true" />,
  neutral: <Info size={18} aria-hidden="true" />,
};

export interface AlertProps {
  color?: AlertColor;
  title?: string;
  children: ReactNode;
  dismissible?: boolean;
  className?: string;
}

/** Inline banner for persistent contextual state — not for one-off action results (use Toast). */
export function Alert({ color = 'info', title, children, dismissible = false, className }: AlertProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      role="alert"
      className={cn('flex items-start gap-3 rounded-md border px-4 py-3 text-sm', COLOR_CLASSES[color], className)}
    >
      <span className="mt-0.5 shrink-0">{ICONS[color]}</span>
      <div className="flex-1">
        {title && <p className="font-medium">{title}</p>}
        <div className={title ? 'mt-0.5' : undefined}>{children}</div>
      </div>
      {dismissible && (
        <IconButton
          icon={<X size={16} />}
          aria-label="Dismiss alert"
          size="sm"
          variant="tertiary"
          className="shrink-0 -mr-1 -mt-1"
          onClick={() => setDismissed(true)}
        />
      )}
    </div>
  );
}
