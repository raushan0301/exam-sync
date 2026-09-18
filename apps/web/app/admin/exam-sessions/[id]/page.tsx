'use client';

import { useParams } from 'next/navigation';
import { ExamSessionDetailView } from '@/components/exam-session/ExamSessionDetailView';

export default function AdminExamSessionDetailPage() {
  const params = useParams<{ id: string }>();
  return <ExamSessionDetailView sessionId={params.id} />;
}
