import { ChartFrame, TableView } from "./chart-frame";

const STEPS = [14, 32, 52, 74, 100];
function shade(v: number, max: number, own: boolean) {
  if (v <= 0 || max <= 0) return "transparent";
  const b = Math.min(STEPS.length - 1, Math.floor((v / max) * STEPS.length - 1e-9));
  // Cross-department flows carry the accent hue; a department using its own kit stays neutral.
  return `color-mix(in oklab, ${own ? "var(--subtle)" : "var(--c-seq)"} ${STEPS[b]}%, var(--card))`;
}

/** Who borrows from whom: rows = borrower's department, columns = department that owns the resource. */
export function FlowMatrix({ title, description, rows, cols, hours }: { title: string; description: string; rows: string[]; cols: string[]; hours: number[][] }) {
  const max = Math.max(0, ...hours.flat());
  const fmt = (v: number) => (v ? `${Math.round(v)}` : "");
  return (
    <ChartFrame>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-[2px] text-xs tabular-nums" aria-describedby="flow-desc">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col" className="p-1.5 text-left font-medium text-muted">
                Borrower ↓ · Owner →
              </th>
              {cols.map((c) => (
                <th key={c} scope="col" className="p-1.5 text-center font-medium text-muted">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r}>
                <th scope="row" className="p-1.5 text-left font-medium whitespace-nowrap text-ink">
                  {r}
                </th>
                {cols.map((c, ci) => {
                  const v = hours[ri][ci];
                  const own = r === c;
                  const dark = v > 0 && v / max > 0.55 && !own;
                  return (
                    <td
                      key={c}
                      tabIndex={v ? 0 : -1}
                      data-tip={v ? `${Math.round(v)} h|${r} → ${c}${own ? " (own department)" : ""}` : undefined}
                      className={`h-9 min-w-12 rounded-[3px] text-center ${own ? "ring-1 ring-[var(--line-strong)] ring-inset" : ""} ${dark ? "text-white" : "text-ink"}`}
                      style={{ background: shade(v, max, own) }}
                    >
                      {fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p id="flow-desc" className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-[3px]" style={{ background: "color-mix(in oklab, var(--c-seq) 74%, var(--card))" }} aria-hidden />
          Borrowed across departments
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-[3px] ring-1 ring-[var(--line-strong)] ring-inset" style={{ background: "color-mix(in oklab, var(--subtle) 52%, var(--card))" }} aria-hidden />
          Own department (outlined)
        </span>
        <span>Numbers are hours. {description}</span>
      </p>
      <TableView caption={title} head={["Borrower", ...cols]} rows={rows.map((r, ri) => [r, ...hours[ri].map((v) => Math.round(v))])} />
    </ChartFrame>
  );
}
