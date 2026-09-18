/**
 * Maps a caught error (typically `ApiError` or `NetworkError` from
 * api-client.ts) to a UI-agnostic shape that ErrorState/Alert/Toast (M1) can
 * render. This file never renders anything itself.
 */

import { ApiError, NetworkError } from './api-client';

export type ErrorKind =
  | 'validation'
  | 'auth'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'locked'
  | 'server'
  | 'network'
  | 'rate-limited'
  | 'unknown';

export interface MappedError {
  title: string;
  description: string;
  kind: ErrorKind;
  /** Structured field-level / conflict details, when the backend provided them (409/422). */
  details?: unknown[];
}

function messageOf(err: ApiError): string {
  return err.message || 'Something went wrong.';
}

export function mapError(err: unknown): MappedError {
  if (err instanceof NetworkError) {
    return {
      kind: 'network',
      title: 'Connection problem',
      description: 'Check your connection and try again.',
    };
  }

  if (err instanceof ApiError) {
    switch (err.status) {
      case 400:
        return {
          kind: 'validation',
          title: 'Invalid request',
          description: messageOf(err),
          details: err.details as unknown[] | undefined,
        };
      case 401:
        return {
          kind: 'auth',
          title: 'Session expired',
          description: 'Please sign in again to continue.',
        };
      case 403:
        return {
          kind: 'forbidden',
          title: 'Access denied',
          description: "You don't have permission to do this.",
        };
      case 404:
        // Neutral on purpose — never reveals whether the resource exists
        // but is forbidden, vs. genuinely absent.
        return {
          kind: 'not-found',
          title: 'Not found',
          description: 'The item you were looking for could not be found.',
        };
      case 409:
        return {
          kind: 'conflict',
          title: 'Conflict',
          description: messageOf(err),
          details: err.details as unknown[] | undefined,
        };
      case 422:
        return {
          kind: 'validation',
          title: 'Validation error',
          description: messageOf(err),
          details: err.details as unknown[] | undefined,
        };
      case 423:
        return {
          kind: 'locked',
          title: 'This resource is locked',
          description: (err.body?.reason as string | undefined) ?? messageOf(err),
        };
      case 429:
        return {
          kind: 'rate-limited',
          title: 'Too many attempts',
          description: 'Please wait a moment before trying again.',
        };
      default:
        if (err.status >= 500) {
          return {
            kind: 'server',
            title: 'Something went wrong',
            description: 'An unexpected server error occurred. Please try again later.',
          };
        }
        return {
          kind: 'unknown',
          title: 'Something went wrong',
          description: messageOf(err),
        };
    }
  }

  return {
    kind: 'unknown',
    title: 'Something went wrong',
    description: 'An unexpected error occurred. Please try again.',
  };
}
