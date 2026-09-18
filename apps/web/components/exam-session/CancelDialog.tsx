'use client';

import { useState } from 'react';
import { Modal, Button, Textarea, Alert } from '@/components/ui';
import { mapError } from '@/lib/error-mapping';
import { useCancelExamSession } from '@/lib/mutations/useExamSessionMutations';

export interface CancelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  sessionName: string;
}

/** Destructive Cancel action — requires a non-empty reason (BR-042/EC-024). */
export function CancelDialog({ open, onOpenChange, sessionId, sessionName }: CancelDialogProps) {
  const [reason, setReason] = useState('');
  const cancelMutation = useCancelExamSession(sessionId);

  async function onConfirm() {
    try {
      await cancelMutation.mutateAsync(reason);
      onOpenChange(false);
      setReason('');
    } catch {
      // surfaced below via cancelMutation.error; keep dialog open so the reason isn't lost
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setReason('');
          cancelMutation.reset();
        }
      }}
      title="Cancel this exam session?"
      description={`"${sessionName}" will be cancelled, every attached quiz released, and every assigned student notified. This cannot be undone.`}
      preventDismiss
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={cancelMutation.isPending}>
            Back
          </Button>
          <Button variant="destructive" onClick={onConfirm} loading={cancelMutation.isPending} disabled={!reason.trim()}>
            Cancel Session
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {cancelMutation.isError && (
          <Alert color="danger" title="Couldn't cancel">
            {mapError(cancelMutation.error).description}
          </Alert>
        )}
        <Textarea
          label="Reason"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain why this exam session is being cancelled."
        />
      </div>
    </Modal>
  );
}
