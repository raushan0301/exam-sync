'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { CheckCircle2, AlertOctagon, Info, X } from 'lucide-react';
import { cn } from './utils';

export type ToastVariant = 'success' | 'danger' | 'info';

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (t: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: 'border-success-border bg-success-bg text-success-text',
  danger: 'border-danger-border bg-danger-bg text-danger-text',
  info: 'border-info-border bg-info-bg text-info-text',
};

const VARIANT_ICON: Record<ToastVariant, ReactNode> = {
  success: <CheckCircle2 size={18} aria-hidden="true" />,
  danger: <AlertOctagon size={18} aria-hidden="true" />,
  info: <Info size={18} aria-hidden="true" />,
};

/**
 * Toast provider using Radix Toast (Portal + Viewport give correct
 * `aria-live` region semantics for free). Bottom-right, auto-dismiss 5s for
 * success/info, persist-until-dismissed for danger, max 3 stacked (UX doc §1).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev.slice(-2), { ...t, id }]); // max 3 stacked
  }, []);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {toasts.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            duration={t.variant === 'danger' ? Infinity : 5000}
            onOpenChange={(open) => !open && remove(t.id)}
            className={cn(
              'flex items-start gap-2.5 rounded-md border px-4 py-3 shadow-elevated w-[340px]',
              'data-[state=open]:animate-none data-[swipe=end]:animate-none',
              VARIANT_CLASSES[t.variant],
            )}
          >
            <span className="mt-0.5 shrink-0">{VARIANT_ICON[t.variant]}</span>
            <div className="flex-1 text-sm">
              <ToastPrimitive.Title className="font-medium">{t.title}</ToastPrimitive.Title>
              {t.description && (
                <ToastPrimitive.Description className="mt-0.5 opacity-90">
                  {t.description}
                </ToastPrimitive.Description>
              )}
            </div>
            <ToastPrimitive.Close aria-label="Dismiss notification" className="shrink-0">
              <X size={16} />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-toast flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

/** useToast().toast({ title, description?, variant }) — result of an action already confirmed elsewhere. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
