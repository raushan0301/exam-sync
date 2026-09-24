'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Check } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/utils';
import { useNotifications } from '@/lib/queries/useNotifications';
import { useMarkNotificationRead } from '@/lib/mutations/useNotificationMutations';

const NOTIFICATIONS_HREF_BY_ROLE: Record<string, string> = {
  ADMIN: '/admin/notifications',
  FACULTY: '/faculty/notifications',
  STUDENT: '/student/notifications',
};

function humanizeEventType(eventType: string): string {
  const lower = eventType.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Header bell — a live quick-preview of `GET /me/notifications` (same
 * self-scoped endpoint the full inbox page uses), not a decorative icon.
 * Shows an unread-count badge and the most recent few, each markable read
 * inline; "View all" links to the role's full inbox for pagination/history.
 * There is no unread-count endpoint, so the count is derived client-side
 * from this same page of results (readAt === null) — accurate for the
 * badge's purpose (an at-a-glance signal) even though it only reflects the
 * fetched page, not a true global total.
 */
export function NotificationsBell({ primaryRole }: { primaryRole: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const notificationsQuery = useNotifications({ limit: 10 });
  const markRead = useMarkNotificationRead();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const items = notificationsQuery.data?.items ?? [];
  const unreadCount = items.filter((n) => !n.readAt).length;
  const inboxHref = primaryRole ? NOTIFICATIONS_HREF_BY_ROLE[primaryRole] : undefined;

  return (
    <div className="relative" ref={ref}>
      <IconButton
        icon={<Bell size={18} />}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        onClick={() => setOpen((o) => !o)}
        className="relative"
      />
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger-text px-1 text-[10px] font-semibold leading-none text-white"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}

      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          className="absolute right-0 z-dropdown mt-1 w-80 rounded-md border border-border bg-surface py-1 shadow-elevated"
        >
          <div className="border-b border-border px-3 py-2 text-xs font-medium text-text-muted">Notifications</div>

          {notificationsQuery.isLoading ? (
            <p className="px-3 py-4 text-sm text-text-muted">Loading…</p>
          ) : notificationsQuery.isError ? (
            <p className="px-3 py-4 text-sm text-danger-text">Couldn&apos;t load notifications.</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-4 text-sm text-text-muted">You&apos;re all caught up — no notifications yet.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((n) => {
                const unread = !n.readAt;
                return (
                  <li
                    key={n.id}
                    className={cn('flex items-start justify-between gap-2 px-3 py-2 text-sm', unread && 'bg-primary-50')}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-600" aria-hidden="true" />}
                      <div className={cn('flex min-w-0 flex-col', !unread && 'pl-4')}>
                        <span className={cn('text-text', unread && 'font-semibold')}>{humanizeEventType(n.eventType)}</span>
                        {typeof n.payload?.message === 'string' && (
                          <span className="text-xs text-text-muted">{n.payload.message as string}</span>
                        )}
                      </div>
                    </div>
                    {unread && (
                      <IconButton
                        icon={<Check size={14} />}
                        aria-label="Mark read"
                        size="sm"
                        disabled={markRead.isPending}
                        onClick={() => markRead.mutate(n.id)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {inboxHref && (
            <div className="border-t border-border px-3 py-2">
              <Link href={inboxHref} onClick={() => setOpen(false)}>
                <Button variant="tertiary" size="sm" className="w-full">
                  View all
                </Button>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
