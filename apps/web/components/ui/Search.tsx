'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { Input } from './Input';

export interface SearchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'onChange' | 'value'> {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  /** Debounce delay in ms before onChange fires. Omit/0 for immediate. */
  debounceMs?: number;
}

/** Labeled search input with optional debounce. */
export const Search = forwardRef<HTMLInputElement, SearchProps>(
  ({ label = 'Search', value, onChange, debounceMs = 0, placeholder = 'Search…', ...props }, ref) => {
    const [local, setLocal] = useState(value);
    const timer = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => setLocal(value), [value]);

    return (
      <Input
        ref={ref}
        label={label}
        placeholder={placeholder}
        leadingIcon={<SearchIcon size={16} aria-hidden="true" />}
        value={local}
        onChange={(e) => {
          const next = e.target.value;
          setLocal(next);
          if (!debounceMs) {
            onChange(next);
            return;
          }
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => onChange(next), debounceMs);
        }}
        {...props}
      />
    );
  },
);
Search.displayName = 'Search';
