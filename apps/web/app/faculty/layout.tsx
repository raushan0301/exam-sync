'use client';

import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { RoleGate } from '@/components/auth/RoleGate';
import { FacultyShell } from '@/components/shell/FacultyShell';

export default function FacultyLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <RoleGate allow={['FACULTY', 'INVIGILATOR']}>
        <FacultyShell>{children}</FacultyShell>
      </RoleGate>
    </AuthGuard>
  );
}
