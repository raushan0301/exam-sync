'use client';

import type { ReactNode } from 'react';
import { AppShell } from './AppShell';
import { ADMIN_NAV } from '@/lib/navigation';

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <AppShell nav={ADMIN_NAV} hasSidebar sidebarStorageKey="exam_sync_admin_sidebar_collapsed">
      {children}
    </AppShell>
  );
}
