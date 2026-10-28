/** Warp and weft threads crossing: the loom. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--ink)" />
      {[9, 16, 23].map((x) => (
        <rect key={`w${x}`} x={x - 1.5} y="6" width="3" height="20" rx="1.5" fill="var(--thread-soft)" />
      ))}
      {[11, 21].map((y, i) => (
        <path
          key={`f${y}`}
          d={`M5 ${y} C 9 ${y - 3}, 12 ${y + 3}, 16 ${y} S 23 ${y - 3}, 27 ${y}`}
          stroke={i ? "#fb923c" : "#a5b4fc"}
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
