'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Card, Input, DateInput, TimeInput, FormField, Button, Alert, ConfirmationDialog, Radio, RadioGroup, StatusBadge, EmptyState, LoadingState } from '@/components/ui';
import { mapError } from '@/lib/error-mapping';
import { useCreateExamSession } from '@/lib/mutations/useExamSessionMutations';
import { apiFetch } from '@/lib/api-client';
import { useQuiz, useQuizzes } from '@/lib/queries/useQuizzes';
import { formatTime } from '@/lib/format-time';
import type { ExamSessionDetail } from '@/lib/queries/types';

const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;

/** "HH:MM" + minutes -> "HH:MM", used to derive a session end time from a quiz's preferred_time + duration_minutes. */
function addMinutesHHMM(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (h * 60 + m + minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Matches CreateExamSessionDto (apps/api/src/modules/exam-session/dto) exactly. */
const createExamSessionSchema = z.object({
  name: z.string().min(1, 'Name is required.'),
  session_date: z.string().min(1, 'Date is required.'),
  start_time: z.string().regex(TIME_REGEX, 'Start time must be in HH:MM format.'),
  end_time: z.string().regex(TIME_REGEX, 'End time must be in HH:MM format.'),
});

type CreateExamSessionFormValues = z.infer<typeof createExamSessionSchema>;

/**
 * FACULTY "New Exam Session" — reworked so the approved quiz is picked
 * FIRST, before any session-creation form is shown. The backend still
 * models this as two calls (`POST /exam-sessions` then
 * `PATCH /exam-sessions/{id}/quizzes`, since a session is created bare and
 * ownership is established at the first quiz attach — see
 * ExamSessionsService.attachAndDetachQuizzes), but this page chains them
 * into one submit so the faculty never sees a session that isn't already
 * tied to their chosen quiz.
 */
export default function NewExamSessionPage() {
  const router = useRouter();
  const createMutation = useCreateExamSession();
  const approvedQuizzesQuery = useQuizzes({ status: 'APPROVED', all: true });
  const [selectedQuizId, setSelectedQuizId] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Held rooms are tied to the quiz's approved date and time — creating the session for another slot releases them, so say so first.
  const [pendingValues, setPendingValues] = useState<CreateExamSessionFormValues | null>(null);
  const quizDetailQuery = useQuiz(selectedQuizId || undefined);

  const allQuizzes = approvedQuizzesQuery.data?.items ?? [];
  // A quiz already actively attached to a session can't be picked again —
  // starting a second session for the same quiz makes no sense. Shown
  // instead, read-only, so a faculty can see it's already scheduled and
  // jump to that session rather than wondering where it went.
  const quizzes = allQuizzes.filter((q) => !q.examSession);
  const scheduledQuizzes = allQuizzes.filter((q) => !!q.examSession);
  const selectedQuiz = quizzes.find((q) => q.id === selectedQuizId);

  const form = useForm<CreateExamSessionFormValues>({
    resolver: zodResolver(createExamSessionSchema),
    defaultValues: { name: '', session_date: '', start_time: '', end_time: '' },
  });

  function onSelectQuiz(quizId: string) {
    setSelectedQuizId(quizId);
    const quiz = quizzes.find((q) => q.id === quizId);
    if (!quiz) return;
    form.reset({
      name: form.getValues('name') || `${quiz.title} — Exam`,
      // Both come back as full ISO datetimes (Prisma DateTime columns used
      // as date-only/time-only, backed by a bogus 1970-01-01 date for
      // preferredTime) — slice to the plain "YYYY-MM-DD"/"HH:MM" these
      // native <input type="date">/<input type="time"> fields need.
      session_date: quiz.preferredDate ? quiz.preferredDate.slice(0, 10) : form.getValues('session_date'),
      start_time: quiz.preferredTime ? quiz.preferredTime.slice(11, 16) : form.getValues('start_time'),
      // The quiz's own approved slot only has a start time + duration, no
      // explicit end time — derive one (defaulting to 120 min when the
      // quiz never set a duration) so the faculty isn't left picking an
      // end time totally unrelated to what was actually approved.
      end_time: quiz.preferredTime
        ? addMinutesHHMM(quiz.preferredTime.slice(11, 16), quiz.durationMinutes ?? 120)
        : form.getValues('end_time'),
    });
  }

  const holds = quizDetailQuery.data?.roomHolds ?? [];
  const approvedSlot =
    selectedQuiz?.preferredDate && selectedQuiz.preferredTime
      ? {
          date: selectedQuiz.preferredDate.slice(0, 10),
          start: selectedQuiz.preferredTime.slice(11, 16),
          end: addMinutesHHMM(selectedQuiz.preferredTime.slice(11, 16), selectedQuiz.durationMinutes ?? 120),
        }
      : null;

  function differsFromApprovedSlot(values: CreateExamSessionFormValues): boolean {
    if (holds.length === 0 || !approvedSlot) return false;
    return (
      values.session_date !== approvedSlot.date ||
      values.start_time.slice(0, 5) !== approvedSlot.start ||
      values.end_time.slice(0, 5) !== approvedSlot.end
    );
  }

  async function onSubmit(values: CreateExamSessionFormValues) {
    if (differsFromApprovedSlot(values)) {
      setPendingValues(values); // ask first — see the dialog below
      return;
    }
    await createSession(values);
  }

  async function createSession(values: CreateExamSessionFormValues) {
    setSubmitError(null);
    try {
      const session = await createMutation.mutateAsync(values);
      try {
        await apiFetch<ExamSessionDetail>(`/exam-sessions/${session.id}/quizzes`, {
          method: 'PATCH',
          body: { add: [selectedQuizId], remove: [] },
        });
      } catch (attachErr) {
        // Session exists but the attach failed (e.g. a conflict) — send the
        // faculty to its detail page, where QuizAttachPanel lets them retry,
        // instead of losing the session they just created.
        router.push(`/faculty/exam-sessions/${session.id}`);
        return;
      }
      router.push(`/faculty/exam-sessions/${session.id}`);
    } catch (err) {
      setSubmitError(mapError(err).description);
    }
  }

  if (approvedQuizzesQuery.isLoading) {
    return <LoadingState label="Loading your approved quizzes…" />;
  }

  if (allQuizzes.length === 0) {
    return (
      <EmptyState
        title="No approved quizzes yet"
        description="You need at least one of your own quizzes approved by an admin before you can schedule an exam session for it."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">New Exam Session</h1>
        <p className="text-sm text-text-muted">Pick one of your approved quizzes, then schedule a session for it.</p>
      </div>

      {quizzes.length === 0 ? (
        <EmptyState
          title="All your approved quizzes are already scheduled"
          description="Every approved quiz already has an exam session — see the list below to open one, or attach an additional quiz from an existing session's detail page."
        />
      ) : (
        <Card>
          <RadioGroup name="quiz" label="Approved quiz" className="gap-3">
            {quizzes.map((quiz) => (
              <Radio
                key={quiz.id}
                value={quiz.id}
                checked={selectedQuizId === quiz.id}
                onChange={() => onSelectQuiz(quiz.id)}
                label={`${quiz.title}${quiz.preferredDate ? ` — preferred ${quiz.preferredDate.slice(0, 10)}${quiz.preferredTime ? ` ${formatTime(quiz.preferredTime)}` : ''}` : ''}`}
              />
            ))}
          </RadioGroup>
        </Card>
      )}

      {selectedQuiz && (
        <Card>
          <FormProvider {...form}>
            <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
              {submitError && <Alert color="danger">{submitError}</Alert>}

              <FormField<CreateExamSessionFormValues> name="name" label="Name" required>
                {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
              </FormField>

              <FormField<CreateExamSessionFormValues> name="session_date" label="Date" required>
                {(field) => <DateInput {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
              </FormField>

              <div className="grid grid-cols-2 gap-4">
                <FormField<CreateExamSessionFormValues> name="start_time" label="Start Time" required>
                  {(field) => <TimeInput id={field.id} ariaLabel="Start Time" value={(field.value as string) ?? ''} onChange={(v) => field.onChange(v)} />}
                </FormField>
                <FormField<CreateExamSessionFormValues> name="end_time" label="End Time" required>
                  {(field) => <TimeInput id={field.id} ariaLabel="End Time" value={(field.value as string) ?? ''} onChange={(v) => field.onChange(v)} />}
                </FormField>
              </div>

              <div className="flex justify-end">
                <Button type="submit" loading={createMutation.isPending}>
                  Create &amp; Attach Quiz
                </Button>
              </div>
            </form>
          </FormProvider>
        </Card>
      )}

      <ConfirmationDialog
        open={pendingValues !== null}
        onOpenChange={(next) => {
          if (!next) setPendingValues(null);
        }}
        title="Different date or time — held rooms will be released"
        description={`The rooms approved for this quiz are held for ${approvedSlot?.date ?? ''}, ${approvedSlot?.start ?? ''}–${approvedSlot?.end ?? ''}. You are creating the session for a different date or time, so: the held rooms will be released (you will be notified); their availability is checked again for the new time when you request or allocate rooms; and if a room is not free then, you will need to request rooms again and an admin must approve them.`}
        confirmLabel="Release rooms and continue"
        cancelLabel="Keep the approved time"
        loading={createMutation.isPending}
        onConfirm={async () => {
          const values = pendingValues;
          setPendingValues(null);
          if (values) await createSession(values);
        }}
      />

      {scheduledQuizzes.length > 0 && (
        <Card header={<h2 className="text-sm font-semibold text-text">Already scheduled</h2>}>
          <ul className="flex flex-col gap-2">
            {scheduledQuizzes.map((quiz) => (
              <li key={quiz.id} className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm">
                <span className="text-text">{quiz.title}</span>
                <div className="flex items-center gap-2">
                  <StatusBadge status={quiz.examSession!.status} />
                  <Link href={`/faculty/exam-sessions/${quiz.examSession!.id}`} className="text-primary-600 hover:underline">
                    Open session
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
