'use client';

import { useState } from 'react';
import { Modal, Button, Textarea, Alert } from '@/components/ui';
import { mapError } from '@/lib/error-mapping';
import { useRequestSuspension } from '@/lib/mutations/useSuspensionMutations';

/** Same minimum the API enforces — a real explanation, not a word. */
export const MIN_SUSPENSION_REASON_LENGTH = 10;

export interface SuspensionRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  sessionName: string;
}

/**
 * Faculty ask to suspend (cancel) a session. Nothing is cancelled here — the
 * request goes to an admin, and only their approval releases the session's
 * quizzes, rooms, invigilators and seating and moves it to History.
 */
export function SuspensionRequestDialog({ open, onOpenChange, sessionId, sessionName }: SuspensionRequestDialogProps) {
  const [reason, setReason] = useState('');
  const requestMutation = useRequestSuspension(sessionId);
  const trimmedLength = reason.trim().length;
  const tooShort = trimmedLength < MIN_SUSPENSION_REASON_LENGTH;

  async function onConfirm() {
    try {
      await requestMutation.mutateAsync(reason.trim());
      onOpenChange(false);
      setReason('');
    } catch {
      // surfaced below via requestMutation.error; keep the dialog open so the reason isn't lost
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setReason('');
          requestMutation.reset();
        }
      }}
      title="Request to suspend this exam session?"
      description={`Your request goes to an admin for approval. If approved, “${sessionName}” is cancelled and moved to History — its quizzes, rooms, invigilators and seating are released and assigned students are notified. Nothing changes until an admin approves.`}
      preventDismiss
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={requestMutation.isPending}>
            Back
          </Button>
          <Button variant="destructive" onClick={onConfirm} loading={requestMutation.isPending} disabled={tooShort}>
            Send Request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {requestMutation.isError && (
          <Alert color="danger" title="Couldn't send the request">
            {mapError(requestMutation.error).description}
          </Alert>
        )}
        <Textarea
          label="Why should this session be suspended?"
          required
          rows={5}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain why this exam session no longer needs to be conducted, so the admin can decide."
        />
        <p className="text-xs text-text-muted" aria-live="polite">
          {tooShort
            ? `At least ${MIN_SUSPENSION_REASON_LENGTH} characters (${trimmedLength}/${MIN_SUSPENSION_REASON_LENGTH}).`
            : 'Ready to send.'}
        </p>
      </div>
    </Modal>
  );
}
