'use client';

import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from './utils';
import { IconButton } from './IconButton';

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  trigger?: ReactNode;
  /** Width in px on >=sm viewports. Default 480. */
  width?: number;
}

/**
 * Right-side slide-over, built on the same Radix Dialog primitive as Modal
 * (same focus-trap/Escape/backdrop/focus-restoration guarantees) with a
 * different visual treatment: docked right, full-height, slide transition.
 * Becomes a full-screen modal below `sm` per UX doc §12.
 */
export function Drawer({ open, onOpenChange, title, description, children, footer, trigger, width = 480 }: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-modal-backdrop bg-neutral-950/40" />
        <Dialog.Content
          className={cn(
            'fixed right-0 top-0 z-modal flex h-full flex-col border-l border-border bg-surface shadow-elevated',
            'focus:outline-none',
            'transition-transform duration-200 ease data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full',
            'w-full sm:w-[--drawer-width]',
          )}
          style={{ '--drawer-width': `${width}px` } as React.CSSProperties}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-text">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-sm text-text-muted">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton icon={<X size={18} />} aria-label="Close panel" size="md" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
