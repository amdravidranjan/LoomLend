import { ImageResponse } from "next/og";
import { publicStats } from "@/components/ds/server/stats";

export const alt = "LoomLend: share idle campus labs, equipment and spaces, safely.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

const INK = "#1e1b3a";

/** A woven field of warp and weft threads behind the headline, with live numbers. */
export default async function OpenGraphImage() {
  let stats = { resources: 12, hoursShared: 0, peopleServed: 0, departments: 5 };
  try {
    stats = await publicStats();
  } catch {
    // Render the brand card even if the database is unreachable.
  }
  const warps = Array.from({ length: 22 }, (_, i) => 640 + i * 26);
  const wefts = [
    { y: 150, c: "#fb923c" },
    { y: 250, c: "#8b8ef5" },
    { y: 350, c: "#5eead4" },
    { y: 450, c: "#fb923c" },
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#f6f2ea", position: "relative" }}>
        <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: "absolute", left: 0, top: 0 }}>
          <rect x="600" y="0" width="600" height="630" fill={INK} />
          {/* Even warps sit under the weft, odd warps lie over it: a plain weave. */}
          {warps.filter((_, i) => i % 2 === 0).map((x) => (
            <line key={x} x1={x} y1="0" x2={x} y2="630" stroke="#38346a" strokeWidth="9" />
          ))}
          {wefts.map((w, i) => (
            <path
              key={w.y}
              d={`M600 ${w.y} C 700 ${w.y - 40}, 760 ${w.y + 40}, 860 ${w.y} S 1020 ${w.y - 40}, 1200 ${w.y + (i % 2 ? 20 : -20)}`}
              stroke={w.c}
              strokeWidth="12"
              fill="none"
              strokeLinecap="round"
            />
          ))}
          {warps.filter((_, i) => i % 2 === 1).map((x) => (
            <line key={x} x1={x} y1="0" x2={x} y2="630" stroke="#38346a" strokeWidth="9" />
          ))}
        </svg>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 48px 56px 72px", width: 600, height: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <svg width="64" height="64" viewBox="0 0 32 32">
              <rect x="0.5" y="0.5" width="31" height="31" rx="9" fill={INK} />
              <path d="M20.5 5.5v21" stroke="#8b8ef5" strokeOpacity="0.55" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <path d="M11 6.5v11a5 5 0 0 0 5 5h9.5" stroke={INK} strokeWidth="7" strokeLinecap="round" fill="none" />
          <path d="M11 6.5v11a5 5 0 0 0 5 5h9.5" stroke="#fb923c" strokeWidth="4.4" strokeLinecap="round" fill="none" />
          <path d="M11 6.5v10" stroke="#c9cbff" strokeWidth="4.4" strokeLinecap="round" fill="none" />
            </svg>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: "#1c1a27", letterSpacing: -1 }}>LoomLend</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 58, fontWeight: 700, color: "#1c1a27", lineHeight: 1.05, letterSpacing: -2 }}>Idle labs, woven into shared opportunity.</div>
            <div style={{ display: "flex", marginTop: 22, fontSize: 26, color: "#625e70", lineHeight: 1.35 }}>Eligibility checks, fair allocation and a tamper-evident trail.</div>
          </div>
          <div style={{ display: "flex", gap: 40 }}>
            {[
              [stats.resources, "resources listed"],
              [stats.hoursShared, "hours shared"],
              [stats.peopleServed, "people served"],
            ].map(([n, l]) => (
              <div key={String(l)} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: "#4338ca" }}>{n}</div>
                <div style={{ display: "flex", fontSize: 20, color: "#625e70" }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
