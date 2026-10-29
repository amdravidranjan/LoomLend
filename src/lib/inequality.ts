// Pure inequality metrics for the fairness ledger (unit-tested, no database).

/**
 * Gini coefficient of non-negative amounts: 0 = everyone got the same, 1 = one person got everything.
 * G = (2 Σ i·x_i) / (n Σ x) − (n + 1) / n, with x sorted ascending and i = 1..n.
 */
export function gini(values: number[]) {
  const x = values.filter((v) => v >= 0).sort((a, b) => a - b);
  const n = x.length;
  const total = x.reduce((s, v) => s + v, 0);
  if (n === 0 || total === 0) return 0;
  const weighted = x.reduce((s, v, i) => s + (i + 1) * v, 0);
  return Math.max(0, (2 * weighted) / (n * total) - (n + 1) / n);
}

/** Lorenz curve points from (0,0) to (1,1): share of people (poorest first) vs share of hours. */
export function lorenz(values: number[]): { p: number; share: number }[] {
  const x = values.filter((v) => v >= 0).sort((a, b) => a - b);
  const n = x.length;
  const total = x.reduce((s, v) => s + v, 0);
  const pts = [{ p: 0, share: 0 }];
  if (n === 0) return [...pts, { p: 1, share: 1 }];
  let cum = 0;
  x.forEach((v, i) => {
    cum += v;
    pts.push({ p: (i + 1) / n, share: total ? cum / total : (i + 1) / n });
  });
  return pts;
}

/** Share of the total held by the top `fraction` of people (at least one person). */
export function topShare(values: number[], fraction = 0.1) {
  const x = values.filter((v) => v >= 0).sort((a, b) => b - a);
  const total = x.reduce((s, v) => s + v, 0);
  if (!x.length || !total) return 0;
  const k = Math.max(1, Math.ceil(x.length * fraction));
  return x.slice(0, k).reduce((s, v) => s + v, 0) / total;
}

export function median(values: number[]) {
  if (!values.length) return null;
  const x = [...values].sort((a, b) => a - b);
  const m = Math.floor(x.length / 2);
  return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
}

export const GINI_ALERT = 0.5;
