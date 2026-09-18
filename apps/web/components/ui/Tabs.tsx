'use client';

import type { ReactNode } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from './utils';

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

/** Underline-style tabs (not pill/card — UX doc §1) built on Radix Tabs. */
export function Tabs({ items, defaultValue, value, onValueChange, className }: TabsProps) {
  return (
    <TabsPrimitive.Root
      defaultValue={defaultValue ?? items[0]?.value}
      value={value}
      onValueChange={onValueChange}
      className={className}
    >
      <TabsPrimitive.List className="flex gap-5 border-b border-border" aria-label="Tabs">
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className={cn(
              'relative -mb-px border-b-2 border-transparent px-1 py-2.5 text-sm font-medium text-text-muted transition-colors duration-150 ease',
              'hover:text-text',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 rounded-sm',
              'data-[state=active]:border-primary-600 data-[state=active]:text-text',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((item) => (
        <TabsPrimitive.Content key={item.value} value={item.value} className="pt-4 focus-visible:outline-none">
          {item.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
