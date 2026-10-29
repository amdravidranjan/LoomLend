import { ImageResponse } from "next/og";

const INK = "#1e1b3a";

/** Browsers still ask for /favicon.ico; answer with the woven-L mark (PNG) instead of a 404. */
export function GET() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <svg width="32" height="32" viewBox="0 0 32 32">
          <rect x="0.5" y="0.5" width="31" height="31" rx="9" fill={INK} />
          <path d="M20.5 5.5v21" stroke="#8b8ef5" strokeOpacity="0.55" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <path d="M11 6.5v11a5 5 0 0 0 5 5h9.5" stroke={INK} strokeWidth="7" strokeLinecap="round" fill="none" />
          <path d="M11 6.5v11a5 5 0 0 0 5 5h9.5" stroke="#fb923c" strokeWidth="4.4" strokeLinecap="round" fill="none" />
          <path d="M11 6.5v10" stroke="#c9cbff" strokeWidth="4.4" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    ),
    { width: 32, height: 32, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
