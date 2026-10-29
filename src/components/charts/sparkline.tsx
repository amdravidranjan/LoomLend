// Tiny trend line for a KPI tile: de-emphasised line, current period marked with an accent dot.
export function Sparkline({ values, label, width = 112, height = 30 }: { values: number[]; label: string; width?: number; height?: number }) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return null;
  const pad = 4;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (pts.length - 1);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - 2 * pad);
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = pts.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="ll-chart block overflow-visible">
      <title>{label}</title>
      <path d={d} fill="none" stroke="var(--subtle)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(pts[last])} r={4} fill="var(--thread)" stroke="var(--card)" strokeWidth={2} />
    </svg>
  );
}
