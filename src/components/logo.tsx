/**
 * The LoomLend mark: one thread bent into an "L".
 * It starts as an indigo warp (the upright), turns at a soft corner and leaves as a saffron
 * weft (the foot), passing over a second warp thread on its way: one stitch of plain weave.
 * Colours are fixed rather than theme tokens so the mark is identical in the favicon,
 * the Open Graph card and the app, in light and dark.
 */
export const MARK = {
  tile: "#1e1b3a",
  warp: "#c9cbff",
  warp2: "#8b8ef5",
  weft: "#fb923c",
  /** The bent thread: down the upright, round the corner, out along the foot. */
  thread: "M11 6.5v11a5 5 0 0 0 5 5h9.5",
  upright: "M11 6.5v10",
  crossing: "M20.5 5.5v21",
};

export function LogoMark({ size = 28, animated = false, className = "" }: { size?: number; animated?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={`${animated ? "ll-mark-animated" : ""} ${className}`} focusable="false">
      <rect x="0.5" y="0.5" width="31" height="31" rx="9" fill={MARK.tile} />
      {/* hairline edge so the tile holds its shape on the dark theme */}
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="8.75" fill="none" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="0.5" />
      <path d={MARK.crossing} stroke={MARK.warp2} strokeOpacity=".55" strokeWidth="2.4" strokeLinecap="round" fill="none" className="ll-mark-warp" pathLength={1} />
      <path d={MARK.thread} stroke={MARK.tile} strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d={MARK.thread} stroke={MARK.weft} strokeWidth="4.4" strokeLinecap="round" fill="none" className="ll-mark-thread" pathLength={1} />
      <path d={MARK.upright} stroke={MARK.warp} strokeWidth="4.4" strokeLinecap="round" fill="none" className="ll-mark-upright" pathLength={1} />
    </svg>
  );
}

/** Backward-compatible name used across the app. */
export function Logo({ size = 28 }: { size?: number }) {
  return <LogoMark size={size} />;
}

/** Mark + wordmark lockup. The wordmark is Fraunces, set tight, with "Lend" in thread indigo. */
export function LogoLockup({ size = 28, className = "", animated = false }: { size?: number; className?: string; animated?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} animated={animated} />
      <span className="h-display font-semibold tracking-tight text-ink" style={{ fontSize: Math.round(size * 0.74), lineHeight: 1 }}>
        Loom<span className="text-thread">Lend</span>
      </span>
    </span>
  );
}
