"use client";
import { useRef, useState, type ReactNode } from "react";

// Shared hover/focus tooltip for every chart. Marks opt in with data-tip="value|label".
// Values lead, labels follow; text is set as text (never HTML). Tooltips enhance, they never gate:
// every chart also has a table view.

/** Validated chart colours (dataviz validator: light on #fffdf8, dark on #1b1a24, both pass). */
export function ChartTokens() {
  return (
    <style href="ll-chart-tokens" precedence="default">{`
      .ll-chart { --c-booked: #4338ca; --c-unmet: #c2410c; --c-grid: var(--line); --c-seq: #4338ca; }
      [data-theme="dark"] .ll-chart { --c-booked: #7b7ef0; --c-unmet: #dc6c24; --c-seq: #7b7ef0; }
      .ll-chart [data-tip] { outline: none; transition: opacity var(--dur-fast, 150ms); }
      .ll-chart [data-tip]:hover, .ll-chart [data-tip]:focus-visible { opacity: 0.78; }
      .ll-chart [data-tip]:focus-visible { stroke: var(--ink); stroke-width: 2px; }
      @media print { .ll-chart-tip { display: none !important; } .ll-chart details { display: none; } }
      @media (forced-colors: active) { .ll-chart rect[data-tip] { forced-color-adjust: none; } }
    `}</style>
  );
}

export function ChartFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; value: string; label: string } | null>(null);

  function show(target: EventTarget | null, clientX?: number, clientY?: number) {
    const el = (target as Element | null)?.closest?.("[data-tip]");
    const box = ref.current?.getBoundingClientRect();
    if (!el || !box) return setTip(null);
    const [value, label = ""] = (el.getAttribute("data-tip") ?? "").split("|");
    const r = el.getBoundingClientRect();
    const x = (clientX ?? r.left + r.width / 2) - box.left;
    const y = (clientY ?? r.top) - box.top;
    setTip({ x: Math.max(8, Math.min(box.width - 8, x)), y, value, label });
  }

  return (
    <div
      ref={ref}
      className={`ll-chart relative ${className}`}
      onPointerMove={(e) => show(e.target, e.clientX, e.clientY)}
      onPointerLeave={() => setTip(null)}
      onFocus={(e) => show(e.target)}
      onBlur={() => setTip(null)}
    >
      <ChartTokens />
      {children}
      {tip && (
        <div
          role="status"
          className="ll-chart-tip pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-[var(--raised)] px-2.5 py-1.5 text-xs shadow-[var(--shadow-2)]"
          style={{ left: tip.x, top: tip.y - 10 }}
        >
          <div className="font-semibold text-ink tabular-nums">{tip.value}</div>
          {tip.label && <div className="text-muted">{tip.label}</div>}
        </div>
      )}
    </div>
  );
}

export function TableView({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">Show as table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-muted">
              {head.map((h) => (
                <th key={h} scope="col" className="py-1.5 pr-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line/60">
                {r.map((c, j) => (
                  <td key={j} className="py-1.5 pr-3">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
