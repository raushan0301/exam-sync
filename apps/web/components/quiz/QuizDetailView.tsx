'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card, StatusBadge, Button, Alert, ConfirmationDialog, Modal, Textarea, Skeleton, SkeletonText, ErrorState } from '@/components/ui';
import { useQuiz, useQuizApprovalHistory } from '@/lib/queries/useQuizzes';
import { useSubjects } from '@/lib/queries/useSubjects';
import {
  useUpdateQuiz,
  useSubmitQuiz,
  useApproveQuiz,
  useRejectQuiz,
} from '@/lib/mutations/useQuizMutations';
import { ApiError } from '@/lib/api-client';
import { formatTime } from '@/lib/format-time';
import { mapError, specificForbiddenMessage } from '@/lib/error-mapping';
import { QuizForm, editQuizFormSchema, defaultQuizFormValues, toQuizApiPayload, type EditQuizFormValues } from './QuizForm';
import { QuizRoomRequestPanel } from './QuizRoomRequestPanel';
import { QuizRoomConflictPanel } from './QuizRoomConflictPanel';
import { QuizAllocatedRoomsPanel } from './QuizAllocatedRoomsPanel';

export interface QuizDetailViewProps {
  quizId: string;
  role: 'ADMIN' | 'FACULTY';
}

/**
 * Shared quiz detail: read-only fields + approval-history timeline +
 * contextual actions per status/role (per the milestone spec — no
 * stepper component, just conditional buttons). FACULTY editing is
 * offered for DRAFT/REJECTED quizzes (matches quizzes.service.ts's
 * `update` status guard); ADMIN gets Approve/Reject only while SUBMITTED.
 */
export function QuizDetailView({ quizId, role }: QuizDetailViewProps) {
  const quizQuery = useQuiz(quizId);
  const historyQuery = useQuizApprovalHistory(quizId);
  const { data: subjectsData } = useSubjects({ all: true });
  const subjectById = new Map((subjectsData?.items ?? []).map((s) => [s.id, s]));

  const [editing, setEditing] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // The admin's note about the room request — sent with Approve/Reject so it is saved however the admin ordered their clicks.
  const [roomNote, setRoomNote] = useState('');
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  const updateMutation = useUpdateQuiz(quizId);
  const submitMutation = useSubmitQuiz(quizId);
  const approveMutation = useApproveQuiz(quizId);
  const rejectMutation = useRejectQuiz(quizId);

  const editForm = useForm<EditQuizFormValues>({
    resolver: zodResolver(editQuizFormSchema),
    defaultValues: defaultQuizFormValues(quizQuery.data),
  });

  if (quizQuery.isLoading) {
    return (
      <Card>
        <SkeletonText lines={6} />
      </Card>
    );
  }

  if (quizQuery.isError) {
    return <ErrorState title="Couldn't load this quiz" description={mapError(quizQuery.error).description} onRetry={() => quizQuery.refetch()} />;
  }

  const quiz = quizQuery.data;
  if (!quiz) return null;

  function startEdit() {
    editForm.reset(defaultQuizFormValues(quiz, []));
    setEditing(true);
  }

  async function onEditSubmit(values: EditQuizFormValues) {
    try {
      await updateMutation.mutateAsync({ input: toQuizApiPayload(values, true), version: quiz!.version });
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictMessage('This quiz was changed by someone else since you loaded it. Refresh to see the latest version before editing again.');
        quizQuery.refetch();
      } else {
        editForm.setError('root', { message: specificForbiddenMessage(err) ?? mapError(err).description });
      }
    }
  }

  async function onSubmitForApproval() {
    try {
      await submitMutation.mutateAsync();
      setSubmitOpen(false);
    } catch {
      // surfaced via submitMutation.error below
      setSubmitOpen(false);
    }
  }

  async function onApprove() {
    try {
      await approveMutation.mutateAsync({ version: quiz!.version, roomNote });
      setApproveOpen(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictMessage('This quiz was changed by someone else since you loaded it. It has been refreshed — please review and try again.');
        quizQuery.refetch();
      }
      setApproveOpen(false);
    }
  }

  async function onReject() {
    try {
      await rejectMutation.mutateAsync({ reason: rejectReason, roomNote });
      setRejectOpen(false);
      setRejectReason('');
    } catch {
      // surfaced via rejectMutation.error below; keep dialog open so the reason isn't lost
    }
  }

  const canFacultyEdit = role === 'FACULTY' && (quiz.status === 'DRAFT' || quiz.status === 'REJECTED');
  const canAdminReview = role === 'ADMIN' && quiz.status === 'SUBMITTED';

  return (
    <div className="flex flex-col gap-4">
      {conflictMessage && (
        <Alert color="warning" title="Changed by someone else" dismissible>
          {conflictMessage}
        </Alert>
      )}

      <Card
        header={
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-text">{quiz.title}</h1>
            <StatusBadge status={quiz.status} />
          </div>
        }
        footer={
          !editing ? (
            <div className="flex justify-end gap-2">
              {canFacultyEdit && (
                <>
                  <Button variant="secondary" onClick={startEdit}>
                    Edit
                  </Button>
                  <Button onClick={() => setSubmitOpen(true)}>Submit for Approval</Button>
                </>
              )}
              {canAdminReview && (
                <>
                  <Button variant="destructive" onClick={() => setRejectOpen(true)}>
                    Reject
                  </Button>
                  <Button onClick={() => setApproveOpen(true)}>Approve</Button>
                </>
              )}
              {!canFacultyEdit && !canAdminReview && (
                <p className="text-sm text-text-muted">
                  {quiz.status === 'APPROVED' ? 'This quiz is approved and read-only.' : 'No actions available for this status.'}
                </p>
              )}
            </div>
          ) : undefined
        }
      >
        {editing ? (
          <div className="flex flex-col gap-3">
            <QuizForm
              form={editForm}
              submitLabel="Save changes"
              submitting={updateMutation.isPending}
              rootError={editForm.formState.errors.root?.message}
              onSubmit={onEditSubmit}
            />
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-text-muted">Subject</dt>
              <dd className="text-text">{subjectById.get(quiz.subjectId)?.name ?? quiz.subjectId}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Academic Year / Semester</dt>
              <dd className="text-text">{quiz.academicYear} / Sem {quiz.semester}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Duration</dt>
              <dd className="text-text">{quiz.durationMinutes ?? '—'} min</dd>
            </div>
            <div>
              <dt className="text-text-muted">Number of Students</dt>
              <dd className="text-text">{quiz.studentCount ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Quiz Type</dt>
              <dd className="text-text">{quiz.quizType ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Preferred Date</dt>
              <dd className="text-text">{quiz.preferredDate ? quiz.preferredDate.slice(0, 10) : '—'}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Preferred Time</dt>
              <dd className="text-text">{formatTime(quiz.preferredTime)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-text-muted">Instructions</dt>
              <dd className="text-text">{quiz.instructions ?? '—'}</dd>
            </div>
          </dl>
        )}

        {submitMutation.isError && (
          <Alert color="danger" title="Couldn't submit" className="mt-4">
            {mapError(submitMutation.error).description}
          </Alert>
        )}
      </Card>

      {quiz.roomAdjustmentNote && (
        <Alert color="info" title="Admin note on this room request">
          {quiz.roomAdjustmentNote}
        </Alert>
      )}

      {canFacultyEdit && !editing && (
        <Card header={<h2 className="text-sm font-semibold text-text">Room Suggestion</h2>} padding="dense">
          <QuizRoomRequestPanel quiz={quiz} />
        </Card>
      )}

      {(quiz.status === 'SUBMITTED' || quiz.status === 'APPROVED') && (
        <Card
          header={
            <h2 className="text-sm font-semibold text-text">
              {quiz.status === 'APPROVED' ? 'Requested Rooms (at approval time)' : role === 'ADMIN' ? 'Room Availability' : 'Requested Rooms'}
            </h2>
          }
          padding="dense"
        >
          <QuizRoomConflictPanel
            quiz={quiz}
            canSwap={role === 'ADMIN' && quiz.status === 'SUBMITTED'}
            note={roomNote}
            onNoteChange={setRoomNote}
          />
        </Card>
      )}

      {(quiz.examSession?.rooms.length ?? 0) > 0 && (
        <Card header={<h2 className="text-sm font-semibold text-text">Final Allocated Rooms</h2>} padding="dense">
          <QuizAllocatedRoomsPanel quiz={quiz} />
        </Card>
      )}

      <Card header={<h2 className="text-sm font-semibold text-text">Approval History</h2>} padding="dense">
        {historyQuery.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : historyQuery.isError ? (
          <ErrorState description={mapError(historyQuery.error).description} onRetry={() => historyQuery.refetch()} />
        ) : (historyQuery.data ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">No approval activity yet.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {(historyQuery.data ?? []).map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <StatusBadge status={entry.newStatus} />
                  <span className="text-xs text-text-muted">{entry.action}</span>
                  <span className="text-xs text-text-subtle">{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
                {entry.reason && <p className="text-sm text-text">Reason: {entry.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <ConfirmationDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        title="Submit for approval?"
        description="Once submitted, an administrator will review this quiz. You won't be able to edit it while it's under review."
        confirmLabel="Submit"
        loading={submitMutation.isPending}
        onConfirm={onSubmitForApproval}
      />

      <ConfirmationDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="Approve this quiz?"
        description={`"${quiz.title}" will be marked approved and the faculty will be notified.`}
        confirmLabel="Approve"
        loading={approveMutation.isPending}
        onConfirm={onApprove}
      />

      <Modal
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open);
          if (!open) setRejectReason('');
        }}
        title="Reject this quiz?"
        description={`"${quiz.title}" will be sent back to the faculty as rejected. A reason is required.`}
        preventDismiss
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)} disabled={rejectMutation.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onReject} loading={rejectMutation.isPending} disabled={!rejectReason.trim()}>
              Reject
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {rejectMutation.isError && (
            <Alert color="danger" title="Couldn't reject">
              {mapError(rejectMutation.error).description}
            </Alert>
          )}
          <Textarea
            label="Reason"
            required
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Explain what needs to change before this quiz can be approved."
          />
        </div>
      </Modal>
    </div>
  );
}
