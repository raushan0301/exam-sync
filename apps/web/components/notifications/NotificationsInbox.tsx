'use client';

import { useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { Card, Skeleton, EmptyState, ErrorState, Button, Pagination } from '@/components/ui';
import { cn } from '@/components/ui/utils';
import { useNotifications } from '@/lib/queries/useNotifications';
import { useMarkNotificationRead } from '@/lib/mutations/useNotificationMutations';
import { mapError } from '@/lib/error-mapping';
import type { Notification } from '@/lib/queries/types';

/** Humanizes a NotificationEventType-shaped string, e.g. QUIZ_APPROVED -> "Quiz approved". */
function humanizeEventType(eventType: string): string {
  const lower = eventType.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function NotificationRow({ notification }: { notification: Notification }) {
  const markRead = useMarkNotificationRead();
  const unread = !notification.readAt;

  return (
    <li
      className={cn(
        'flex items-start justify-between gap-3 px-4 py-3',
        unread && 'bg-primary-50',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-600" aria-label="unread" />}
        <div className={cn('flex min-w-0 flex-col', !unread && 'pl-4')}>
          <span className={cn('text-sm text-text', unread && 'font-semibold')}>
            {humanizeEventType(notification.eventType)}
          </span>
          {typeof notification.payload?.message === 'string' && (
            <span className="mt-0.5 text-sm text-text-muted">{notification.payload.message as string}</span>
          )}
          <span className="mt-1 text-xs text-text-subtle">{new Date(notification.createdAt).toLocaleString()}</span>
        </div>
      </div>
      {unread && (
        <Button
          size="sm"
          variant="tertiary"
          leadingIcon={<Check size={14} aria-hidden="true" />}
          loading={markRead.isPending}
          onClick={() => markRead.mutate(notification.id)}
        >
          Mark read
        </Button>
      )}
    </li>
  );
}

/**
 * Full paginated notifications inbox, shared by all three role folders
 * (admin/faculty/student) since `GET /me/notifications` is self-scoped and
 * has no role restriction. `readAt === null` is the real unread indicator
 * (the model's `status` field is unrelated outbox-delivery state — SENT vs.
 * read are two different axes — so it is never used for unread logic here).
 */
export function NotificationsInbox() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const { data, isLoading, isError, error, refetch, isFetching } = useNotifications({ cursor, limit: 20 });

  function goNext() {
    if (!data?.next_cursor) return;
    setCursorHistory((h) => [...h, cursor ?? '']);
    setCursor(data.next_cursor);
  }

  function goPrev() {
    setCursorHistory((h) => {
      const next = [...h];
      const prev = next.pop();
      setCursor(prev ? prev : undefined);
      return next;
    });
  }

  if (isLoading) {
    return (
      <Card>
        <div className="flex flex-col gap-3 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (isError) {
    const mapped = mapError(error);
    return (
      <Card>
        <ErrorState title={mapped.title} description={mapped.description} onRetry={() => refetch()} retrying={isFetching} />
      </Card>
    );
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Bell size={28} />}
          title="No notifications yet"
          description="You're all caught up — new notifications will show up here."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="p-0 overflow-hidden">
        <ul className="flex flex-col divide-y divide-border">
          {items.map((n) => (
            <NotificationRow key={n.id} notification={n} />
          ))}
        </ul>
      </Card>
      <Pagination hasNext={!!data?.next_cursor} hasPrev={cursorHistory.length > 0} onNext={goNext} onPrev={goPrev} />
    </div>
  );
}
