import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const INK = "#1e1b3a";

/** Home-screen icon: the woven L on a full-bleed tile (iOS applies its own corner mask). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: INK }}>
        <svg width="180" height="180" viewBox="0 0 32 32">
          <rect width="32" height="32" fill={INK} />
          <path d="M20.5 5.5v21" stroke="#8b8ef5" strokeOpacity="0.55" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <path d="M11 6.5v11a5 5 0 0 0 5 5h9.5" stroke={INK} strokeWidth="7" strokeLinecap="round" fill="none" />
          <path d="M11 6.5v11a5 5 0 0 0 5 5h9.5" stroke="#fb923c" strokeWidth="4.4" strokeLinecap="round" fill="none" />
          <path d="M11 6.5v10" stroke="#c9cbff" strokeWidth="4.4" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    ),
    size,
  );
}
