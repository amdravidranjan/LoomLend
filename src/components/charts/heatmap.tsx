import { ChartFrame, TableView } from "./chart-frame";

const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Five ordered bins, one hue light→dark (sequential). Empty cells stay on the surface.
const STEPS = [14, 32, 52, 74, 100];

function bin(v: number, max: number) {
  if (v <= 0 || max <= 0) return -1;
  return Math.min(STEPS.length - 1, Math.floor((v / max) * STEPS.length - 1e-9));
}
const fill = (b: number) => (b < 0 ? "var(--sunken)" : `color-mix(in oklab, var(--c-seq) ${STEPS[b]}%, var(--card))`);
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;

/** Day × hour grid of requested hours. */
export function Heatmap({ title, description, days, hours, values, unit = "h requested" }: { title: string; description: string; days: number[]; hours: number[]; values: number[][]; unit?: string }) {
  const max = Math.max(0, ...values.flat());
  const cell = 26;
  const gap = 2;
  const left = 36;
  const top = 18;
  const w = left + hours.length * (cell + gap);
  const h = top + days.length * (cell + gap);
  const peak = (() => {
    let best = { d: 0, h: 0, v: -1 };
    values.forEach((row, di) => row.forEach((v, hi) => v > best.v && (best = { d: di, h: hi, v })));
    return best;
  })();
  return (
    <ChartFrame>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ minWidth: 420, maxWidth: w * 1.6 }} role="img" aria-labelledby="hm-title hm-desc">
          <title id="hm-title">{title}</title>
          <desc id="hm-desc">{description}</desc>
          {hours.map((hr, i) =>
            i % 2 === 0 ? (
              <text key={hr} x={left + i * (cell + gap) + cell / 2} y={11} textAnchor="middle" fontSize={9} fill="var(--muted)" className="tabular-nums">
                {hourLabel(hr)}
              </text>
            ) : null,
          )}
          {days.map((d, di) => (
            <g key={d}>
              <text x={0} y={top + di * (cell + gap) + cell / 2 + 3} fontSize={10} fill="var(--muted)">
                {DAY_LABEL[d]}
              </text>
              {hours.map((hr, hi) => {
                const v = values[di][hi];
                return (
                  <rect
                    key={hr}
                    x={left + hi * (cell + gap)}
                    y={top + di * (cell + gap)}
                    width={cell}
                    height={cell}
                    rx={3}
                    fill={fill(bin(v, max))}
                    data-tip={`${v.toFixed(v < 10 ? 1 : 0)} ${unit}|${DAY_LABEL[d]} ${hourLabel(hr)}m–${hourLabel(hr + 1)}m`}
                  />
                );
              })}
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted" aria-hidden>
        <span>Fewer</span>
        {STEPS.map((_, i) => (
          <span key={i} className="inline-block size-3 rounded-[3px]" style={{ background: fill(i) }} />
        ))}
        <span>More requested hours</span>
        {peak.v > 0 && (
          <span className="ml-auto text-ink">
            Peak: {DAY_LABEL[days[peak.d]]} {hourLabel(hours[peak.h])}m
          </span>
        )}
      </div>
      <TableView
        caption={title}
        head={["Day", ...hours.map((x) => `${x}:00`)]}
        rows={days.map((d, di) => [DAY_LABEL[d], ...values[di].map((v) => (v ? v.toFixed(1) : "0"))])}
      />
    </ChartFrame>
  );
}
