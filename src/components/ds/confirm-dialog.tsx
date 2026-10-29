"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "./icons";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Ask the person to confirm. Resolves true on confirm, false on cancel or Escape. */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    pending?.resolve(false);
    pending = { ...opts, resolve };
    emit();
  });
}

function close(ok: boolean) {
  const p = pending;
  pending = null;
  emit();
  p?.resolve(ok);
}

/**
 * A controlled confirmation dialog built on the native <dialog> element (focus trap, Escape and
 * inert background for free). Use <ConfirmHost/> once in the layout for confirmAction(), or render
 * <ConfirmDialog open …/> yourself.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel,
}: ConfirmOptions & { open: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel(); // backdrop click
      }}
      aria-labelledby="ll-confirm-title"
      className="ll-dialog m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-raised p-0 text-ink shadow-3 backdrop:bg-[var(--overlay)]"
    >
      {open && (
        <div className="p-5">
          <div className="flex items-start gap-3">
            <span className={`grid size-10 shrink-0 place-items-center rounded-full ${tone === "danger" ? "bg-rose-soft text-rose" : "bg-thread-soft text-thread"}`}>
              <Icon name={tone === "danger" ? "alert" : "info"} size={20} />
            </span>
            <div className="min-w-0 pt-1">
              <h2 id="ll-confirm-title" className="text-base font-semibold">
                {title}
              </h2>
              {body && <div className="mt-1 text-sm text-muted">{body}</div>}
            </div>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn-ghost" onClick={onCancel} autoFocus>
              {cancelLabel}
            </button>
            <button type="button" className={tone === "danger" ? "btn-danger" : "btn-primary"} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Mount once in the root layout to serve confirmAction(). */
export function ConfirmHost() {
  const p = useSyncExternalStore(subscribe, () => pending, () => null);
  const opts = p;
  return (
    <ConfirmDialog
      open={!!p}
      title={opts?.title ?? ""}
      body={opts?.body}
      confirmLabel={opts?.confirmLabel}
      cancelLabel={opts?.cancelLabel}
      tone={opts?.tone}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );
}
