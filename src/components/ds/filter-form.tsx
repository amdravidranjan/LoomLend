"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Icon } from "./icons";

/**
 * A GET filter form that works without JavaScript and, with it, applies select/radio/checkbox
 * changes immediately (no "Search" round-trip). Text input applies on Enter.
 */
export function FilterForm({ action, children, className = "" }: { action: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  function apply() {
    const f = ref.current;
    if (!f) return;
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(f)) if (typeof v === "string" && v.trim()) params.set(k, v.trim());
    const qs = params.toString();
    start(() => router.replace(`${action}${qs ? `?${qs}` : ""}`, { scroll: false }));
  }
  return (
    <form
      ref={ref}
      action={action}
      role="search"
      aria-busy={pending}
      className={`${className} transition-opacity ${pending ? "opacity-80" : ""}`}
      onChange={(e) => {
        const t = e.target as unknown as HTMLInputElement;
        if (t.type !== "text" && t.type !== "search") apply();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      {children}
    </form>
  );
}

const KEY = "ll-discover-last";

/** Remembers the last Discover search and offers to bring it back (never applies it silently). */
export function DiscoverMemory({ current, labels }: { current: string; labels: string }) {
  const [saved, setSaved] = useState<{ qs: string; labels: string } | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        if (current) localStorage.setItem(KEY, JSON.stringify({ qs: current, labels }));
        else {
          const raw = localStorage.getItem(KEY);
          setSaved(raw ? JSON.parse(raw) : null);
        }
      } catch {}
    }, 0);
    return () => window.clearTimeout(t);
  }, [current, labels]);
  if (current || !saved) return null;
  return (
    <div className="enter mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">Pick up where you left off:</span>
      <Link href={`/resources?${saved.qs}`} className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-thread-soft px-3 py-1 font-medium text-thread hover:border-thread">
        <Icon name="refresh" size={14} />
        {saved.labels}
      </Link>
      <button
        type="button"
        className="text-muted underline-offset-2 hover:text-ink hover:underline"
        onClick={() => {
          try {
            localStorage.removeItem(KEY);
          } catch {}
          setSaved(null);
        }}
      >
        Forget
      </button>
    </div>
  );
}
