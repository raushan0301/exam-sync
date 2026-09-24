'use client';

import { useParams } from 'next/navigation';
import { ExamSessionDetailView } from '@/components/exam-session/ExamSessionDetailView';

/** Faculty-lifecycle-ownership change: admin is now read-only here — `role="ADMIN"` hides every action control in the shared detail view. */
export default function AdminExamSessionDetailPage() {
  const params = useParams<{ id: string }>();
  return <ExamSessionDetailView key={params.id} sessionId={params.id} role="ADMIN" />;
}
