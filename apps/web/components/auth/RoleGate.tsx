'use client';

import type { ReactNode } from 'react';
import { useIdentity } from '@/lib/identity/IdentityProvider';
import { ForbiddenState } from '@/components/feedback/ForbiddenState';

export interface RoleGateProps {
  allow: string[];
  children: ReactNode;
}

/**
 * Defense-in-depth UX convenience only — NOT a security boundary. The
 * backend independently authorizes every request; this only prevents a
 * signed-in user with the wrong role from being shown a broken page in the
 * browser (renders Forbidden instead).
 *
 * INVIGILATOR is folded into the Faculty nav/experience per
 * FRONTEND_UX_ARCHITECTURE.md — treated as FACULTY here for gating.
 */
export function RoleGate({ allow, children }: RoleGateProps) {
  const { primaryRole } = useIdentity();
  const effectiveRole = primaryRole === 'INVIGILATOR' ? 'FACULTY' : primaryRole;

  if (!effectiveRole || !allow.includes(effectiveRole)) {
    return <ForbiddenState />;
  }

  return <>{children}</>;
}

/** Hook form of the same check, for conditional rendering inside a page rather than gating a whole route. */
export function useRequireRole(allow: string[]): { allowed: boolean; primaryRole: string | null } {
  const { primaryRole } = useIdentity();
  const effectiveRole = primaryRole === 'INVIGILATOR' ? 'FACULTY' : primaryRole;
  return { allowed: !!effectiveRole && allow.includes(effectiveRole), primaryRole };
}
