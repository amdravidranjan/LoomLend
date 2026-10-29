"use client";

import { useState } from "react";

/** A long hex value shown truncated, full value on hover and one-click copy. */
export function CopyHash({ value, label = "hash", chars = 12 }: { value: string; label?: string; chars?: number }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
      <code className="truncate rounded bg-paper px-1.5 py-0.5 font-mono text-xs text-ink" title={value}>
        {value.length > chars * 2 ? `${value.slice(0, chars)}…${value.slice(-4)}` : value}
      </code>
      <button type="button" onClick={copy} className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-ink" aria-label={`Copy full ${label}`}>
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </span>
  );
}
