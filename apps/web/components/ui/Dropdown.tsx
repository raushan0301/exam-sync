'use client';

import type { ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { cn } from './utils';

export interface DropdownItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}

export interface DropdownProps {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: 'start' | 'center' | 'end';
}

/**
 * Radix DropdownMenu — a menu (actions), not a form <Select>. Full arrow-key
 * navigation, type-ahead, and Escape-to-close come from Radix.
 */
export function Dropdown({ trigger, items, align = 'end' }: DropdownProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={4}
          className="z-dropdown min-w-[180px] rounded-md border border-border bg-surface p-1 shadow-elevated"
        >
          {items.map((item, i) => (
            <DropdownMenu.Item
              key={i}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-sm outline-none transition-colors duration-150 ease',
                'data-[highlighted]:bg-neutral-100',
                item.danger ? 'text-danger-text' : 'text-text',
                item.disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              {item.icon}
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
