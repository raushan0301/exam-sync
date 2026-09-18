'use client';

import type { ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from './utils';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

/**
 * Radix Tooltip — for icon-only affordances and truncated text only (UX doc
 * §1: "never for content that should just be visible"). Provider should
 * wrap the app once (see TooltipRoot below); each <Tooltip> instance is
 * self-contained here for showcase/demo simplicity.
 */
export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className={cn(
              'z-tooltip rounded border border-border bg-neutral-900 px-2.5 py-1.5 text-xs text-white shadow-elevated',
              'data-[state=delayed-open]:animate-none',
              className,
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-neutral-900" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
