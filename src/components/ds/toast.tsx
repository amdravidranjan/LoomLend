"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "./icons";
import { Celebration } from "./celebrate";

export type ToastTone = "success" | "error" | "info" | "warning";
export type ToastInput = {
  tone?: ToastTone;
  title: string;
  description?: string;
  /** A small woven burst for peak moments (approval, return confirmed). */
  celebrate?: boolean;
  /** Announce through the live region. Off when the same text is already announced inline. */
  announce?: boolean;
  duration?: number;
};
type ToastItem = ToastInput & { id: number; tone: ToastTone };

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Raise a toast from anywhere on the client. */
export function toast(t: ToastInput) {
  const id = ++seq;
  items = [...items.slice(-3), { tone: "info", announce: true, ...t, id }];
  emit();
  return id;
}
export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const EMPTY: ToastItem[] = [];

const TONE: Record<ToastTone, { icon: IconName; bar: string; iconCls: string }> = {
  success: { icon: "check", bar: "bg-teal", iconCls: "bg-teal-soft text-teal" },
  error: { icon: "alert", bar: "bg-rose", iconCls: "bg-rose-soft text-rose" },
  warning: { icon: "alert", bar: "bg-amber", iconCls: "bg-amber-soft text-amber-ink" },
  info: { icon: "info", bar: "bg-thread", iconCls: "bg-thread-soft text-thread" },
};

function ToastCard({ t }: { t: ToastItem }) {
  const [leaving, setLeaving] = useState(false);
  const paused = useRef(false);
  const remaining = useRef(t.duration ?? (t.tone === "error" ? 8000 : 4500));

  useEffect(() => {
    let last = Date.now();
    const iv = window.setInterval(() => {
      const now = Date.now();
      if (!paused.current) remaining.current -= now - last;
      last = now;
      if (remaining.current <= 0) {
        window.clearInterval(iv);
        setLeaving(true);
        window.setTimeout(() => dismissToast(t.id), 180);
      }
    }, 100);
    return () => window.clearInterval(iv);
  }, [t.id]);

  const s = TONE[t.tone];
  return (
    <li
      className={`pointer-events-auto relative flex w-full items-start gap-3 rounded-xl border border-line bg-raised p-3 pr-2 text-sm shadow-3 sm:w-96 ${leaving ? "opacity-0 transition-opacity duration-150" : "pop"}`}
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onFocus={() => (paused.current = true)}
      onBlur={() => (paused.current = false)}
    >
      <span className={`absolute inset-y-0 left-0 w-1 rounded-l-xl ${s.bar}`} aria-hidden />
      <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${s.iconCls}`}>
        <Icon name={s.icon} size={15} strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1 py-0.5">
        <span className="block font-medium text-ink">{t.title}</span>
        {t.description && <span className="mt-0.5 block text-muted">{t.description}</span>}
      </span>
      <button
        type="button"
        onClick={() => dismissToast(t.id)}
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink"
        aria-label="Dismiss notification"
      >
        <Icon name="x" size={16} />
      </button>
      {t.celebrate && <Celebration />}
    </li>
  );
}

/** Mount once (in the root layout). Toasts stack bottom-right, or above the tab bar on phones. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  const announced = list.filter((t) => t.announce !== false).at(-1);
  return (
    <div id="ll-toaster" className="no-print">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic>
        {announced ? `${announced.title}. ${announced.description ?? ""}` : ""}
      </div>
      <ol
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-3 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+12px)] z-[70] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 md:bottom-5"
      >
        {list.map((t) => (
          <ToastCard key={t.id} t={t} />
        ))}
      </ol>
    </div>
  );
}
