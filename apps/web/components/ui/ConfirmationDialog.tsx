'use client';

import { Modal } from './Modal';
import { Button } from './Button';

export interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}

/**
 * Modal preset for destructive/high-blast-radius confirmations (UX doc §6/§13):
 * names the specific consequence in `description` (caller's responsibility —
 * never a generic "Are you sure?"), requires explicit Cancel (no backdrop/Esc
 * dismiss) when `destructive`, and colors the confirm button red in that case.
 */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
}: ConfirmationDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      preventDismiss={destructive}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <></>
    </Modal>
  );
}
