import type { ReactNode } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { cn } from '@/components/ui/utils';

export type KpiTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONE_VALUE_CLASSES: Record<KpiTone, string> = {
  neutral: 'text-text',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
  info: 'text-info-text',
};

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  href?: string;
  tone?: KpiTone;
  description?: string;
  className?: string;
}

/**
 * Generic KPI/summary tile reused across all three dashboards. When `href`
 * is provided the whole tile is a link; otherwise it's a static summary
 * (used for tiles whose destination page isn't built yet — callers should
 * omit `href` in that case, consistent with lib/navigation.ts's
 * disabled-label convention for not-yet-built destinations).
 */
export function KpiTile({ label, value, icon, href, tone = 'neutral', description, className }: KpiTileProps) {
  const content = (
    <Card padding="dense" className={cn('flex flex-col gap-1 transition-shadow', href && 'hover:shadow-md', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-text-muted">{label}</span>
        {icon && (
          <span className="text-text-subtle" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <span className={cn('text-2xl font-semibold', TONE_VALUE_CLASSES[tone])}>{value}</span>
      {description && <span className="text-xs text-text-muted">{description}</span>}
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 rounded-lg">
        {content}
      </Link>
    );
  }
  return content;
}

export function KpiTileSkeleton() {
  return (
    <Card padding="dense" className="flex flex-col gap-2">
      <div className="h-4 w-24 animate-pulse rounded bg-neutral-200" />
      <div className="h-7 w-14 animate-pulse rounded bg-neutral-200" />
    </Card>
  );
}
