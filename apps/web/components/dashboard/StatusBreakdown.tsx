import { Badge, type BadgeColor } from '@/components/ui/Badge';
import { StatusBadge, STATUS_CONFIG, type StatusValue } from '@/components/ui/StatusBadge';

/**
 * IncidentSeverity (LOW/MEDIUM/HIGH/CRITICAL) isn't a status enum covered
 * by STATUS_CONFIG (that table is status-only across domains), so it gets
 * its own semantic color mapping here, following the same success/warning/
 * danger/info/neutral palette convention — CRITICAL/HIGH read as danger so
 * they're visually called out, consistent with the design system's status
 * colors.
 */
const SEVERITY_COLOR: Record<string, BadgeColor> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'danger',
};

export interface StatusBreakdownItem {
  status: StatusValue | (string & Record<never, never>);
  count: number;
}

export interface StatusBreakdownProps {
  items: StatusBreakdownItem[];
  /** 'status' (default) uses StatusBadge/STATUS_CONFIG; 'severity' uses the IncidentSeverity palette above. */
  kind?: 'status' | 'severity';
  className?: string;
}

/** Renders a row of status/severity badge + count pairs — used for quiz-status and incident-severity bucket displays. */
export function StatusBreakdown({ items, kind = 'status', className }: StatusBreakdownProps) {
  return (
    <div className={className ? className : 'flex flex-wrap gap-3'}>
      {items.map((item) =>
        kind === 'severity' ? (
          <div key={item.status} className="flex items-center gap-2">
            <Badge color={SEVERITY_COLOR[item.status] ?? 'neutral'}>{item.status}</Badge>
            <span className="text-sm font-medium text-text">{item.count}</span>
          </div>
        ) : (
          <div key={item.status} className="flex items-center gap-2">
            <StatusBadge status={item.status} />
            <span className="text-sm font-medium text-text">{item.count}</span>
          </div>
        ),
      )}
    </div>
  );
}

export { STATUS_CONFIG };
