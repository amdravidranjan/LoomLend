import type { CSSProperties } from "react";

const TILE = "#1e1b3a";
const WARP = "#36326a";
const W = 520;
const H = 440;

/**
 * The landing hero: a loom. Warp threads stand still; weft threads (each one a borrow) are
 * shuttled in one after another, alternately passing over and under the warps, and a few carry
 * a booking tag. Pure SVG + CSS; under reduced motion it renders finished and still.
 */
export function HeroWeave({ tags }: { tags: { label: string; meta: string }[] }) {
  const warps = Array.from({ length: 15 }, (_, i) => 40 + i * 32);
  const rows = [
    { y: 70, c: "#fb923c" },
    { y: 118, c: "#9da0ff" },
    { y: 166, c: "#5eead4" },
    { y: 214, c: "#fb923c" },
    { y: 262, c: "#c9cbff" },
    { y: 310, c: "#fbbf24" },
    { y: 358, c: "#9da0ff" },
  ];
  const wave = (y: number, i: number) => {
    const a = i % 2 ? 7 : -7;
    let d = `M18 ${y}`;
    for (let x = 18; x < W - 18; x += 64) d += ` q 16 ${a} 32 0 t 32 0`;
    return d;
  };
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="ll-weave block h-auto w-full" role="img" aria-label="Threads being woven on a loom: each thread is a borrow">
        <defs>
          <clipPath id="ll-weave-clip">
            <rect width={W} height={H} rx="28" />
          </clipPath>
          <linearGradient id="ll-weave-fade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0.75" stopColor={TILE} stopOpacity="0" />
            <stop offset="1" stopColor={TILE} stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <g clipPath="url(#ll-weave-clip)">
          <rect width={W} height={H} fill={TILE} />
          {/* under-warps */}
          {warps.filter((_, i) => i % 2 === 0).map((x) => (
            <line key={x} x1={x} x2={x} y1="0" y2={H} stroke={WARP} strokeWidth="9" strokeLinecap="round" />
          ))}
          {rows.map((r, i) => (
            <path
              key={r.y}
              d={wave(r.y, i)}
              fill="none"
              stroke={r.c}
              strokeWidth="11"
              strokeLinecap="round"
              pathLength={1}
              className="ll-weft"
              style={{ "--d": `${200 + i * 260}ms` } as CSSProperties}
            />
          ))}
          {/* over-warps: drawn above the weft so it passes under them */}
          {warps.filter((_, i) => i % 2 === 1).map((x) => (
            <line key={x} x1={x} x2={x} y1="0" y2={H} stroke={WARP} strokeWidth="9" strokeLinecap="round" />
          ))}
          {/* the shuttle */}
          <g className="ll-shuttle">
            <rect x="-22" y={406 - 7} width="44" height="14" rx="7" fill="#fb923c" />
            <rect x="-10" y={406 - 2} width="20" height="4" rx="2" fill={TILE} opacity="0.6" />
          </g>
          <path d={`M18 406 H ${W - 18}`} stroke="#fb923c" strokeOpacity=".35" strokeWidth="2" strokeDasharray="2 8" strokeLinecap="round" />
          <rect width={W} height={H} fill="url(#ll-weave-fade)" />
        </g>
      </svg>
      {/* Booking tags pinned to a few threads */}
      {tags.slice(0, 3).map((t, i) => (
        <div
          key={t.label}
          className="ll-weave-tag absolute flex items-center gap-2 rounded-xl border border-white/10 bg-[#2a2650]/90 px-3 py-2 text-xs text-white shadow-3 backdrop-blur"
          style={{ top: `${[9, 44, 72][i]}%`, [i === 1 ? "right" : "left"]: i === 1 ? "-12px" : "-14px", "--d": `${900 + i * 650}ms` } as CSSProperties}
        >
          <span className={`size-2 rounded-full ${["bg-[#fb923c]", "bg-[#5eead4]", "bg-[#9da0ff]"][i]}`} aria-hidden />
          <span>
            <span className="block font-medium">{t.label}</span>
            <span className="block text-[11px] text-white/65">{t.meta}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
