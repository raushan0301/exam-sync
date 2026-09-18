'use client';

import { Bell } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SkeletonText } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useNotifications } from '@/lib/queries/useNotifications';
import { mapError } from '@/lib/error-mapping';

/** Humanizes a NotificationEventType-shaped string, e.g. QUIZ_APPROVED -> "Quiz approved". */
function humanizeEventType(eventType: string): string {
  const lower = eventType.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export interface NotificationsPanelProps {
  limit?: number;
}

/**
 * "Recent notifications" panel — the one section genuinely backed by real
 * data for ALL THREE roles (GET /me/notifications is self-scoped and has
 * no role restriction). Reused as-is by admin/faculty/student dashboards.
 */
export function NotificationsPanel({ limit = 8 }: NotificationsPanelProps) {
  const { data, isLoading, isError, error, refetch, isFetching } = useNotifications({ limit });

  if (isLoading) {
    return (
      <Card header={<h2 className="text-sm font-semibold text-text">Recent Notifications</h2>}>
        <SkeletonText lines={4} />
      </Card>
    );
  }

  if (isError) {
    const mapped = mapError(error);
    return (
      <Card header={<h2 className="text-sm font-semibold text-text">Recent Notifications</h2>}>
        <ErrorState
          title={mapped.title}
          description={mapped.description}
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      </Card>
    );
  }

  const items = data?.items ?? [];
  const unreadCount = items.filter((n) => !n.readAt).length;

  return (
    <Card
      header={
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Recent Notifications</h2>
          {unreadCount > 0 && <Badge color="info">{unreadCount} unread</Badge>}
        </div>
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon={<Bell size={28} />}
          title="No notifications yet"
          description="You're all caught up — new notifications will show up here."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-text">{humanizeEventType(n.eventType)}</span>
                <span className="text-xs text-text-muted">{new Date(n.createdAt).toLocaleString()}</span>
              </div>
              {!n.readAt && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-600" aria-label="unread" />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
