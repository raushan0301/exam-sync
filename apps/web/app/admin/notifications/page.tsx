'use client';

import { NotificationsInbox } from '@/components/notifications/NotificationsInbox';

export default function AdminNotificationsPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Notifications</h1>
        <p className="mt-1 text-sm text-text-muted">Your in-app notifications.</p>
      </div>
      <NotificationsInbox />
    </div>
  );
}
