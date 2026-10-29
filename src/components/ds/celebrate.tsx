"use client";

import type { CSSProperties } from "react";

const COLORS = ["var(--thread)", "var(--saffron)", "var(--teal)", "#c9cbff", "var(--saffron)"];

/**
 * A short burst of loose thread ends: the "peak" of the peak-end rule, for approvals and
 * completed returns. 14 strands, ~900 ms, then gone. Positions are deterministic (no RNG)
 * and the whole thing is skipped under prefers-reduced-motion via CSS.
 */
export function Celebration({ className = "" }: { className?: string }) {
  const strands = Array.from({ length: 14 }, (_, i) => {
    const angle = (i / 14) * Math.PI * 2 + (i % 3) * 0.17;
    const dist = 46 + ((i * 37) % 30);
    return {
      i,
      style: {
        "--dx": `${Math.cos(angle) * dist}px`,
        "--dy": `${Math.sin(angle) * dist - 14}px`,
        "--rot": `${(i * 53) % 180}deg`,
        animationDelay: `${(i % 4) * 25}ms`,
      } as CSSProperties,
      color: COLORS[i % COLORS.length],
      d: i % 2 ? "M1 7c3-6 6-6 9 0s6 6 9 0" : "M1 4c5 4 10 4 16 0",
    };
  });
  return (
    <span className={`ll-celebrate pointer-events-none absolute top-1/2 left-6 ${className}`} aria-hidden>
      {strands.map((s) => (
        <svg key={s.i} width="20" height="10" viewBox="0 0 20 10" style={s.style} className="ll-strand">
          <path d={s.d} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      ))}
    </span>
  );
}
