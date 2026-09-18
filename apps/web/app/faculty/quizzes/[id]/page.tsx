'use client';

import { useParams } from 'next/navigation';
import { QuizDetailView } from '@/components/quiz/QuizDetailView';

export default function FacultyQuizDetailPage() {
  const params = useParams<{ id: string }>();
  return <QuizDetailView quizId={params.id} role="FACULTY" />;
}
