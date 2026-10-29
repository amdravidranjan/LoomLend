import { ChartFrame, TableView } from "./chart-frame";

export type BarDatum = { key: string; label: string; value: number; display: string; note?: string; marker?: number; markerLabel?: string };

/**
 * Horizontal bars, one series. Thin bars (14px) grow from one baseline with a rounded data end;
 * the value sits at the tip in text ink. An optional marker draws a reference tick (e.g. 100%).
 */
export function BarList({
  title,
  description,
  data,
  max,
  tone = "booked",
  unitLabel,
}: {
  title: string;
  description: string;
  data: BarDatum[];
  max: number;
  tone?: "booked" | "unmet";
  unitLabel: string;
}) {
  const color = tone === "booked" ? "var(--c-booked)" : "var(--c-unmet)";
  const scale = max > 0 ? max : 1;
  return (
    <ChartFrame>
      <figure aria-label={title}>
        <figcaption className="sr-only">{description}</figcaption>
        <ul className="space-y-2.5" role="list">
          {data.map((d) => {
            const pct = Math.max(0, Math.min(100, (d.value / scale) * 100));
            return (
              <li
                key={d.key}
                tabIndex={0}
                data-tip={`${d.display}|${d.label}${d.note ? ` · ${d.note}` : ""}`}
                className="grid grid-cols-[minmax(7rem,11rem)_1fr] items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-thread sm:grid-cols-[minmax(9rem,14rem)_1fr]"
              >
                <span className="truncate text-sm text-ink" title={d.label}>
                  {d.label}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="relative h-3.5 flex-1 overflow-visible">
                    <span className="absolute inset-y-0 left-0 w-full rounded-r-[4px] bg-[var(--sunken)]" aria-hidden />
                    <span
                      className="absolute inset-y-0 left-0 rounded-r-[4px]"
                      style={{ width: `${pct}%`, minWidth: d.value > 0 ? 2 : 0, background: color }}
                      aria-hidden
                    />
                    {d.marker !== undefined && (
                      <span
                        className="absolute -inset-y-1 w-px bg-[var(--line-strong)]"
                        style={{ left: `${Math.min(100, (d.marker / scale) * 100)}%` }}
                        aria-hidden
                        title={d.markerLabel}
                      />
                    )}
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs font-medium text-ink tabular-nums">{d.display}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </figure>
      <TableView caption={title} head={["Resource", unitLabel, "Detail"]} rows={data.map((d) => [d.label, d.display, d.note ?? ""])} />
    </ChartFrame>
  );
}
