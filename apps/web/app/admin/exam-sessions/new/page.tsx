'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Faculty-lifecycle-ownership change: admin can no longer create exam
 * sessions (that's exclusively faculty-driven now — see
 * apps/web/app/faculty/exam-sessions/new/page.tsx). This route is kept as
 * a redirect, rather than deleted outright, so any stale bookmark or
 * external link lands somewhere useful (the new read-only list) instead
 * of a 404.
 */
export default function AdminExamSessionsNewRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/exam-sessions');
  }, [router]);
  return null;
}
