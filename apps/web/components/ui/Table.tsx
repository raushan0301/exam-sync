import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from './utils';

/**
 * Thin wrappers around a real <table>. Sticky header via `sticky top-0`,
 * hairline row borders (no zebra striping by default per UX doc §1), hover
 * state on rows, monospace variant for ID cells. Wrap in `<div className="overflow-x-auto">`
 * (done by `Table` itself) so a table never causes page-level horizontal scroll.
 */
export function Table({ className, children, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border">
      <table className={cn('w-full border-collapse text-sm', className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ className, children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn('sticky top-0 z-sticky bg-neutral-50', className)} {...props}>
      {children}
    </thead>
  );
}

export function TableBody({ className, children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={className} {...props}>
      {children}
    </tbody>
  );
}

export function TableRow({
  className,
  clickable,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { clickable?: boolean }) {
  return (
    <tr
      className={cn(
        'border-b border-border last:border-b-0 transition-colors duration-150 ease',
        clickable && 'cursor-pointer hover:bg-neutral-50',
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, align = 'left', ...props }: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      scope="col"
      className={cn(
        'px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-text-muted',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  align = 'left',
  mono = false,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center'; mono?: boolean }) {
  return (
    <td
      className={cn(
        'px-4 py-3 text-text',
        mono && 'font-mono text-xs',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
      {...props}
    />
  );
}
