'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card } from '@/components/ui';
import { useCreateQuiz } from '@/lib/mutations/useQuizMutations';
import { mapError } from '@/lib/error-mapping';
import { QuizForm, quizFormSchema, defaultQuizFormValues, toQuizApiPayload, type QuizFormValues } from '@/components/quiz/QuizForm';

export default function NewQuizPage() {
  const router = useRouter();
  const createMutation = useCreateQuiz();

  const form = useForm<QuizFormValues>({
    resolver: zodResolver(quizFormSchema),
    defaultValues: defaultQuizFormValues(),
  });

  async function onSubmit(values: QuizFormValues) {
    try {
      const quiz = await createMutation.mutateAsync({ ...toQuizApiPayload(values), batch_ids: values.batch_ids });
      router.push(`/faculty/quizzes/${quiz.id}`);
    } catch (err) {
      form.setError('root', { message: mapError(err).description });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">New Quiz</h1>
        <p className="text-sm text-text-muted">Fill in as much as you have now — you can save it as a draft and finish it later.</p>
      </div>
      <Card>
        <QuizForm
          form={form}
          submitLabel="Create Quiz"
          submitting={createMutation.isPending}
          rootError={form.formState.errors.root?.message}
          onSubmit={onSubmit}
        />
      </Card>
    </div>
  );
}
