import type { ReactNode } from 'react';
import { cn } from './utils';

export interface CardProps {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
  padding?: 'dense' | 'default';
}

/** Surface + hairline border + resting shadow. Optional header/footer slots. */
export function Card({ children, header, footer, className, padding = 'default' }: CardProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface shadow-card', className)}>
      {header && <div className="border-b border-border px-4 py-3">{header}</div>}
      <div className={padding === 'dense' ? 'p-4' : 'p-6'}>{children}</div>
      {footer && <div className="border-t border-border px-4 py-3">{footer}</div>}
    </div>
  );
}
