"use client";

import { useState } from "react";
import { toast } from "@/components/ds/toast";
import { confirmAction } from "@/components/ds/confirm-dialog";
import { Icon } from "@/components/ds/icons";
import { openPalette, openShortcuts } from "@/components/ds/events";
import { Celebration } from "@/components/ds/celebrate";

export function ToastDemos() {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-ghost" onClick={() => toast({ tone: "success", title: "Approved. The requester has been notified.", celebrate: true })}>
        Success + celebration
      </button>
      <button type="button" className="btn-ghost" onClick={() => toast({ tone: "error", title: "That didn't go through", description: "The slot overlaps an approved booking." })}>
        Error
      </button>
      <button type="button" className="btn-ghost" onClick={() => toast({ tone: "warning", title: "Return due in 15 min", description: "Laser Cutter · M-104" })}>
        Warning
      </button>
      <button type="button" className="btn-ghost" onClick={() => toast({ tone: "info", title: "Moved up the waiting list", description: "You're now first for Thu 10:00." })}>
        Info
      </button>
    </div>
  );
}

export function ConfirmDemo() {
  const [result, setResult] = useState<string>("");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn-danger"
        onClick={async () => setResult((await confirmAction({ title: "Cancel this booking?", body: "Anyone on the waiting list moves up straight away.", confirmLabel: "Cancel booking", cancelLabel: "Keep it", tone: "danger" })) ? "Confirmed" : "Kept")}
      >
        Cancel booking…
      </button>
      <button type="button" className="btn-ghost" onClick={async () => setResult((await confirmAction({ title: "Publish this listing?", body: "Members can request it immediately.", confirmLabel: "Publish" })) ? "Confirmed" : "Kept")}>
        Neutral confirm…
      </button>
      {result && <span className="text-sm text-muted" role="status">Result: {result}</span>}
    </div>
  );
}

export function OverlayDemos() {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-ghost" onClick={() => openPalette()}>
        <Icon name="search" size={16} />
        Command palette
      </button>
      <button type="button" className="btn-ghost" onClick={() => openShortcuts()}>
        <Icon name="keyboard" size={16} />
        Shortcut sheet
      </button>
    </div>
  );
}

export function CelebrateDemo() {
  const [n, setN] = useState(0);
  return (
    <button type="button" className="btn-ok relative" onClick={() => setN((x) => x + 1)}>
      <Icon name="check" size={16} />
      Confirm return
      {n > 0 && <Celebration key={n} className="!left-1/2" />}
    </button>
  );
}

export function MotionDemo({ name, ms, ease }: { name: string; ms: string; ease: string }) {
  const [on, setOn] = useState(false);
  return (
    <button type="button" onClick={() => setOn((o) => !o)} className="group flex w-full items-center gap-3 rounded-lg border border-line bg-field p-3 text-left text-sm hover:border-line-strong" aria-label={`Play ${name}`}>
      <span className="relative h-2 flex-1 rounded-full bg-sunken">
        <span className="absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-thread" style={{ left: on ? "calc(100% - 16px)" : "0", transition: `left ${ms} ${ease}` }} />
      </span>
      <span className="w-40 shrink-0">
        <span className="block font-mono text-xs">{name}</span>
        <span className="block text-xs text-muted">{ms}</span>
      </span>
    </button>
  );
}
