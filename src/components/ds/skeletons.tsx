import { Skeleton, SkeletonCard, SkeletonText } from "./primitives";

/** Page header placeholder sized like PageHeader, so content doesn't jump when it arrives. */
export function HeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-72 max-w-[70vw]" />
      </div>
      {action && <Skeleton className="h-10 w-36 rounded-lg" />}
    </div>
  );
}

export function PageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      <HeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="card space-y-4 p-5">
          <Skeleton className="h-5 w-40" />
          <SkeletonText lines={4} />
        </div>
        <div className="card space-y-4 p-5">
          <Skeleton className="h-5 w-32" />
          <SkeletonText lines={3} />
        </div>
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 6, label = "Loading" }: { count?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      <HeaderSkeleton />
      <Skeleton className="mb-5 h-36 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 5, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      <HeaderSkeleton />
      <div className="card divide-y divide-line">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 p-4" aria-hidden>
            <Skeleton className="size-11 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
