'use client';

import type { ReactNode } from 'react';
import { AppShell } from './AppShell';
import { STUDENT_NAV } from '@/lib/navigation';

/** Student: no desktop sidebar per FRONTEND_UX_ARCHITECTURE.md §2 — top-bar-only shell with a mobile bottom nav. */
export function StudentShell({ children }: { children: ReactNode }) {
  return (
    <AppShell nav={STUDENT_NAV} hasSidebar={false}>
      {children}
    </AppShell>
  );
}
