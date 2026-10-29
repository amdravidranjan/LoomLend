"use client";

import { useEffect, useState } from "react";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return d ? `${d} d ${h} h ${pad(m)} m` : h ? `${h} h ${pad(m)} m ${pad(sec)} s` : `${m} m ${pad(sec)} s`;
}

/** Ticks every second in the browser. `now` comes from the server so the first render matches. */
export function Countdown({ target, now, title, done = "closing now — the draw runs on the next page load" }: { target: number; now: number; title?: string; done?: string }) {
  const [t, setT] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = target - t;
  return (
    <time dateTime={new Date(target).toISOString()} className="font-mono tabular-nums" title={title}>
      {left > 0 ? parts(left) : done}
    </time>
  );
}
