'use client';

import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from './utils';
import { IconButton } from './IconButton';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  trigger?: ReactNode;
  /** Max width in px. Default 480 per UX doc §1 ("short, focused actions"). */
  maxWidth?: number;
  /** Mid-destructive-action modals require explicit Cancel — disables Esc/backdrop dismiss. */
  preventDismiss?: boolean;
}

/**
 * Built on Radix Dialog — gives us, for free: focus trap, Escape-to-close,
 * backdrop-click-to-close, and focus restoration to the trigger on close.
 * Do not hand-roll this: correct focus management for a modal is exactly
 * the kind of thing Radix exists to get right (per the task's tech decision).
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  trigger,
  maxWidth = 480,
  preventDismiss = false,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-modal-backdrop bg-neutral-950/40 data-[state=open]:animate-none" />
        <Dialog.Content
          onEscapeKeyDown={(e) => preventDismiss && e.preventDefault()}
          onPointerDownOutside={(e) => preventDismiss && e.preventDefault()}
          onInteractOutside={(e) => preventDismiss && e.preventDefault()}
          className={cn(
            'fixed left-1/2 top-1/2 z-modal flex max-h-[85vh] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface shadow-elevated',
            'focus:outline-none',
            // Full-screen below `sm` per UX doc §12 responsive rule for Modal/Drawer.
            'sm:w-full max-sm:fixed max-sm:inset-4 max-sm:top-4 max-sm:left-4 max-sm:h-[calc(100%-32px)] max-sm:max-h-none max-sm:translate-x-0 max-sm:translate-y-0',
          )}
          style={{ maxWidth }}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-text">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-sm text-text-muted">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton icon={<X size={18} />} aria-label="Close dialog" size="md" />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
