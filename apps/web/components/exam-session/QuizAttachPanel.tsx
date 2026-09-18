'use client';

import { useState } from 'react';
import { Button, Select, Alert } from '@/components/ui';
import { useQuizzes } from '@/lib/queries/useQuizzes';
import { mapError } from '@/lib/error-mapping';
import type { ExamSessionDetail } from '@/lib/queries/types';
import { useUpdateSessionQuizzes } from '@/lib/mutations/useExamSessionMutations';

export interface QuizAttachPanelProps {
  session: ExamSessionDetail;
}

/**
 * Attached-quiz list with per-row Detach, plus an Attach picker sourced
 * from `GET /quizzes?status=APPROVED` (BR-011/BR-017 — only APPROVED
 * quizzes are attachable). Only permitted while the session is DRAFT
 * (exam-sessions.service.ts's `attachAndDetachQuizzes` guard) — the panel
 * still shows the current list read-only past that point.
 */
export function QuizAttachPanel({ session }: QuizAttachPanelProps) {
  const editable = session.status === 'DRAFT';
  const approvedQuizzesQuery = useQuizzes({ status: 'APPROVED', limit: 200 });
  const updateQuizzesMutation = useUpdateSessionQuizzes(session.id);
  const [selectedQuizId, setSelectedQuizId] = useState('');

  const attachedIds = new Set(session.quizzes.map((q) => q.id));
  const attachableOptions = (approvedQuizzesQuery.data?.items ?? [])
    .filter((q) => !attachedIds.has(q.id))
    .map((q) => ({ value: q.id, label: q.title }));

  async function onAttach() {
    if (!selectedQuizId) return;
    try {
      await updateQuizzesMutation.mutateAsync({ add: [selectedQuizId], remove: [] });
      setSelectedQuizId('');
    } catch {
      // surfaced below via updateQuizzesMutation.error
    }
  }

  async function onDetach(quizId: string) {
    try {
      await updateQuizzesMutation.mutateAsync({ add: [], remove: [quizId] });
    } catch {
      // surfaced below via updateQuizzesMutation.error
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {updateQuizzesMutation.isError && (
        <Alert color="danger" title="Couldn't update quizzes">
          {mapError(updateQuizzesMutation.error).description}
        </Alert>
      )}

      {session.quizzes.length === 0 ? (
        <p className="text-sm text-text-muted">No quizzes attached yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {session.quizzes.map((quiz) => (
            <li key={quiz.id} className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm">
              <span className="text-text">{quiz.title}</span>
              {editable && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onDetach(quiz.id)}
                  loading={updateQuizzesMutation.isPending}
                >
                  Detach
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Select
              label="Attach a quiz"
              value={selectedQuizId}
              onChange={(e) => setSelectedQuizId(e.target.value)}
              options={attachableOptions}
              placeholder={approvedQuizzesQuery.isLoading ? 'Loading approved quizzes…' : 'Select an approved quiz'}
            />
          </div>
          <Button onClick={onAttach} disabled={!selectedQuizId} loading={updateQuizzesMutation.isPending}>
            Attach
          </Button>
        </div>
      )}
    </div>
  );
}
