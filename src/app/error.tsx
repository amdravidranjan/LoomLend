"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ThreadIllustration } from "@/components/ds/primitives";
import { Icon } from "@/components/ds/icons";

/** Route-level error boundary: explain, offer a retry, keep the header and navigation usable. */
export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    console.error(error);
    heading.current?.focus();
  }, [error]);
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  return (
    <div className="enter mx-auto flex max-w-md flex-col items-center py-14 text-center" role="alert">
      <ThreadIllustration kind="knot" size={110} />
      <h1 ref={heading} tabIndex={-1} className="h-display mt-6 text-3xl font-semibold tracking-tight outline-none">
        A thread got tangled
      </h1>
      <p className="mt-2 text-muted">Something went wrong loading this page. Nothing you did was lost: every change is saved only when it succeeds.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => retry()} className="btn-primary">
          <Icon name="refresh" size={16} />
          Try again
        </button>
        <Link href="/" className="btn-ghost">
          Back home
        </Link>
      </div>
      {digest && <p className="mt-6 font-mono text-xs text-subtle">Reference: {digest}</p>}
    </div>
  );
}
