'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button, Modal, Alert, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui';
import { mapError } from '@/lib/error-mapping';
import type { ImportJob } from '@/lib/queries/types';

export interface BulkImportModalProps {
  open: boolean;
  onClose: () => void;
  /** Human-readable entity name, e.g. "Department", used in headings and messages. */
  entityLabel: string;
  onDownloadTemplate: () => void | Promise<void>;
  onUpload: (file: File) => Promise<{ job_id: string }>;
  onPollJob: (id: string) => Promise<ImportJob>;
}

const POLL_INTERVAL_MS = 1500;

type Phase = 'idle' | 'uploading' | 'polling' | 'done' | 'error';

/**
 * Shared bulk-import UI for all 7 entities: download the .xlsx template,
 * upload a filled-in copy, then poll the generic `GET /import-jobs/{id}`
 * endpoint until the job reaches a terminal status, showing per-row results.
 */
export function BulkImportModal({
  open,
  onClose,
  entityLabel,
  onDownloadTemplate,
  onUpload,
  onPollJob,
}: BulkImportModalProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      // Reset state whenever the modal closes so re-opening starts fresh.
      setPhase('idle');
      setSelectedFile(null);
      setJob(null);
      setErrorMessage(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  async function handleDownloadTemplate() {
    try {
      await onDownloadTemplate();
    } catch (err) {
      setErrorMessage(mapError(err).description);
    }
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setPhase('uploading');
    setErrorMessage(null);
    try {
      const { job_id } = await onUpload(selectedFile);
      setPhase('polling');
      pollJob(job_id);
    } catch (err) {
      setPhase('error');
      setErrorMessage(mapError(err).description);
    }
  }

  function pollJob(jobId: string) {
    onPollJob(jobId)
      .then((result) => {
        if (result.status === 'COMPLETED' || result.status === 'FAILED') {
          setJob(result);
          setPhase('done');
        } else {
          pollTimeoutRef.current = setTimeout(() => pollJob(jobId), POLL_INTERVAL_MS);
        }
      })
      .catch((err) => {
        setPhase('error');
        setErrorMessage(mapError(err).description);
      });
  }

  const failedRows = job?.results.filter((r) => r.status === 'FAILURE') ?? [];
  const isBusy = phase === 'uploading' || phase === 'polling';

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={`Bulk import ${entityLabel}s`}
      description="Download the template, fill it in, then upload it here."
      maxWidth={640}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {phase === 'done' ? 'Close' : 'Cancel'}
          </Button>
          {phase !== 'done' && (
            <Button onClick={handleUpload} disabled={!selectedFile} loading={isBusy}>
              Upload
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {errorMessage && <Alert color="danger">{errorMessage}</Alert>}

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium text-text">1. Download the template</p>
            <p className="text-xs text-text-muted">
              An .xlsx file with the required columns and an example row.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Download size={14} aria-hidden="true" />}
            onClick={handleDownloadTemplate}
          >
            Download Template
          </Button>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p className="text-sm font-medium text-text">2. Upload your filled-in file</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            disabled={isBusy || phase === 'done'}
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            className="text-sm text-text-muted file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-text hover:file:bg-neutral-50"
          />
        </div>

        {isBusy && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            {phase === 'uploading' ? 'Uploading…' : 'Processing rows…'}
          </div>
        )}

        {phase === 'done' && job && (
          <div className="flex flex-col gap-3">
            <Alert color={job.failureCount > 0 ? (job.successCount > 0 ? 'warning' : 'danger') : 'success'}>
              {job.successCount} of {job.totalRows} row(s) imported successfully
              {job.failureCount > 0 ? `, ${job.failureCount} failed.` : '.'}
            </Alert>

            {failedRows.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row #</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {failedRows.map((row) => (
                      <TableRow key={row.row}>
                        <TableCell mono>{row.row}</TableCell>
                        <TableCell>{row.error ?? 'Unknown error'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
