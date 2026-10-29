// Accessible Lorenz curve: pure SVG, theme colours from CSS variables, with a data-table fallback.

export function LorenzChart({ points, gini, title, size = 180 }: { points: { p: number; share: number }[]; gini: number; title: string; size?: number }) {
  const pad = 22;
  const w = size;
  const inner = w - pad - 6;
  const x = (p: number) => pad + p * inner;
  const y = (s: number) => 6 + (1 - s) * inner;
  const line = points.map((pt) => `${x(pt.p).toFixed(1)},${y(pt.share).toFixed(1)}`).join(" ");
  const area = `${x(0)},${y(0)} ${line} ${x(1)},${y(0)}`;
  const id = `lz-${title.replace(/[^a-z0-9]/gi, "").slice(0, 24)}`;
  const desc = `Lorenz curve. Gini ${gini.toFixed(2)}. ${points
    .filter((_, i) => i > 0)
    .slice(-4)
    .map((pt) => `${Math.round(pt.p * 100)}% of people hold ${Math.round(pt.share * 100)}% of hours`)
    .join("; ")}.`;
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${w} ${w}`} width={w} height={w} role="img" aria-labelledby={`${id}-t ${id}-d`} className="max-w-full">
        <title id={`${id}-t`}>{title}</title>
        <desc id={`${id}-d`}>{desc}</desc>
        <rect x={pad} y={6} width={inner} height={inner} fill="none" stroke="var(--line)" />
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} stroke="var(--line)" strokeWidth={0.5}>
            <line x1={x(g)} x2={x(g)} y1={y(0)} y2={y(1)} />
            <line x1={x(0)} x2={x(1)} y1={y(g)} y2={y(g)} />
          </g>
        ))}
        {/* Inequality gap between equality and the curve */}
        <polygon points={`${x(0)},${y(0)} ${x(1)},${y(1)} ${line.split(" ").reverse().join(" ")}`} fill="var(--saffron)" opacity={0.14} />
        <polygon points={area} fill="var(--thread)" opacity={0.08} />
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--muted)" strokeDasharray="4 3" strokeWidth={1.2} />
        <polyline points={line} fill="none" stroke="var(--thread)" strokeWidth={2.2} strokeLinejoin="round" />
        {points.length <= 25 && points.slice(1, -1).map((pt) => <circle key={pt.p} cx={x(pt.p)} cy={y(pt.share)} r={2.2} fill="var(--thread)" />)}
        <text x={pad} y={w - 4} fontSize={9} fill="var(--muted)">0%</text>
        <text x={w - 6} y={w - 4} fontSize={9} fill="var(--muted)" textAnchor="end">people →100%</text>
        <text x={pad - 3} y={12} fontSize={9} fill="var(--muted)" textAnchor="end">100%</text>
        <text x={x(0.52)} y={y(0.5) - 4} fontSize={8} fill="var(--muted)" transform={`rotate(-45 ${x(0.52)} ${y(0.5) - 4})`}>equal share</text>
      </svg>
      <figcaption className="text-xs text-muted">
        <span className="mr-2 inline-block h-0.5 w-4 bg-thread align-middle" aria-hidden /> actual ·{" "}
        <span className="mr-1 inline-block w-4 border-t border-dashed border-muted align-middle" aria-hidden /> perfectly equal
      </figcaption>
      <details className="text-xs">
        <summary className="cursor-pointer text-thread">Show data table</summary>
        <table className="mt-1 w-full">
          <caption className="sr-only">{title} data</caption>
          <thead>
            <tr className="text-left text-muted"><th scope="col">Poorest share of people</th><th scope="col">Share of hours they hold</th></tr>
          </thead>
          <tbody>
            {points.map((pt) => (
              <tr key={pt.p}><td>{Math.round(pt.p * 100)}%</td><td>{(pt.share * 100).toFixed(1)}%</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Small horizontal meter (e.g. hours used vs cap). */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const tone = pct >= 1 ? "var(--rose)" : pct >= 0.75 ? "var(--saffron)" : "var(--teal)";
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Number(value.toFixed(1))} aria-label={label} className="h-2 w-full overflow-hidden rounded-full bg-line/60">
      <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: tone }} />
    </div>
  );
}
