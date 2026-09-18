'use client';

import type { ReactNode } from 'react';
import { AppShell } from './AppShell';
import { FACULTY_NAV } from '@/lib/navigation';

export function FacultyShell({ children }: { children: ReactNode }) {
  return (
    <AppShell nav={FACULTY_NAV} hasSidebar sidebarStorageKey="exam_sync_faculty_sidebar_collapsed">
      {children}
    </AppShell>
  );
}
