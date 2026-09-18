'use client';

import { useRouter } from 'next/navigation';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, Input, DateInput, FormField, Button, Alert } from '@/components/ui';
import { mapError } from '@/lib/error-mapping';
import { useCreateExamSession } from '@/lib/mutations/useExamSessionMutations';

const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;

/** Matches CreateExamSessionDto (apps/api/src/modules/exam-session/dto) exactly. */
const createExamSessionSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  session_date: z.string().min(1, 'Date is required.'),
  start_time: z.string().regex(TIME_REGEX, 'Start time must be in HH:MM format.'),
  end_time: z.string().regex(TIME_REGEX, 'End time must be in HH:MM format.'),
});

type CreateExamSessionFormValues = z.infer<typeof createExamSessionSchema>;

export default function NewExamSessionPage() {
  const router = useRouter();
  const createMutation = useCreateExamSession();

  const form = useForm<CreateExamSessionFormValues>({
    resolver: zodResolver(createExamSessionSchema),
    defaultValues: { name: '', session_date: '', start_time: '', end_time: '' },
  });

  async function onSubmit(values: CreateExamSessionFormValues) {
    try {
      const session = await createMutation.mutateAsync(values);
      router.push(`/admin/exam-sessions/${session.id}`);
    } catch (err) {
      form.setError('root', { message: mapError(err).description });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">New Exam Session</h1>
        <p className="text-sm text-text-muted">Create a session, then attach approved quizzes to it from its detail page.</p>
      </div>
      <Card>
        <FormProvider {...form}>
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            {form.formState.errors.root && <Alert color="danger">{form.formState.errors.root.message}</Alert>}

            <FormField<CreateExamSessionFormValues> name="name" label="Name" required>
              {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>

            <FormField<CreateExamSessionFormValues> name="session_date" label="Date" required>
              {(field) => <DateInput {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField<CreateExamSessionFormValues> name="start_time" label="Start Time" required>
                {(field) => <Input type="time" {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
              </FormField>
              <FormField<CreateExamSessionFormValues> name="end_time" label="End Time" required>
                {(field) => <Input type="time" {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
              </FormField>
            </div>

            <div className="flex justify-end">
              <Button type="submit" loading={createMutation.isPending}>
                Create Exam Session
              </Button>
            </div>
          </form>
        </FormProvider>
      </Card>
    </div>
  );
}
