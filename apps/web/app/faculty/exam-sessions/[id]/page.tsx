'use client';

import { useParams } from 'next/navigation';
import { ExamSessionDetailView } from '@/components/exam-session/ExamSessionDetailView';

/**
 * FACULTY exam-session lifecycle management — added by the
 * faculty-lifecycle-ownership change. `role="FACULTY"` (the default)
 * makes every action control in the shared detail view actionable:
 * quiz attach/detach, reschedule, cancel, assign students, room
 * allocation (with the new room-availability calendar), seating
 * generate/finalize, and invigilator assignment — all gated server-side
 * by `ExamSessionOwnershipService` (own/co-instruct at least one
 * actively-attached quiz).
 */
export default function FacultyExamSessionDetailPage() {
  const params = useParams<{ id: string }>();
  return <ExamSessionDetailView key={params.id} sessionId={params.id} role="FACULTY" />;
}
