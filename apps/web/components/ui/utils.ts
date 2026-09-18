import { clsx, type ClassValue } from 'clsx';

/** Thin class-name join helper (clsx re-export) used across all primitives. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
