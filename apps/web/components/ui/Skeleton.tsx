import { cn } from './utils';

export interface SkeletonProps {
  className?: string;
}

/** Base skeleton block — pulse animation only (functional, no bounce/reveal). */
export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('animate-pulse rounded bg-neutral-200', className)} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function SkeletonCircle({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-full bg-neutral-200', className)}
      style={{ width: size, height: size }}
    />
  );
}
