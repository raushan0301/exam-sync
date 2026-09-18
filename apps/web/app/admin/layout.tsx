'use client';

import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { RoleGate } from '@/components/auth/RoleGate';
import { AdminShell } from '@/components/shell/AdminShell';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <RoleGate allow={['ADMIN']}>
        <AdminShell>{children}</AdminShell>
      </RoleGate>
    </AuthGuard>
  );
}
