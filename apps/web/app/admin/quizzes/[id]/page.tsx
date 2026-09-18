'use client';

import { useParams } from 'next/navigation';
import { QuizDetailView } from '@/components/quiz/QuizDetailView';

export default function AdminQuizDetailPage() {
  const params = useParams<{ id: string }>();
  return <QuizDetailView quizId={params.id} role="ADMIN" />;
}
