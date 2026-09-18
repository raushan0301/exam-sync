'use client';

import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { RoleGate } from '@/components/auth/RoleGate';
import { StudentShell } from '@/components/shell/StudentShell';

export default function StudentLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <RoleGate allow={['STUDENT']}>
        <StudentShell>{children}</StudentShell>
      </RoleGate>
    </AuthGuard>
  );
}
