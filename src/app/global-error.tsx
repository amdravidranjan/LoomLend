"use client";

/**
 * Last-resort boundary when the root layout itself fails. It renders its own document, so it
 * carries its own minimal styles and follows the OS colour scheme.
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en-IN">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", background: "light-dark(#f6f2ea, #13121a)", color: "light-dark(#1c1a27, #ece8df)", colorScheme: "light dark" }}>
        <title>Something went wrong · LoomLend</title>
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <svg width="56" height="56" viewBox="0 0 32 32" aria-hidden>
            <rect x="0.5" y="0.5" width="31" height="31" rx="9" fill="#1e1b3a" />
            <path d="M20.5 5.5v21" stroke="#8b8ef5" strokeOpacity=".55" strokeWidth="2.4" strokeLinecap="round" fill="none" />
            <path d="M11 6.5v11a5 5 0 0 0 5 5h9.5" stroke="#fb923c" strokeWidth="4.4" strokeLinecap="round" fill="none" />
            <path d="M11 6.5v10" stroke="#c9cbff" strokeWidth="4.4" strokeLinecap="round" fill="none" />
          </svg>
          <h1 style={{ fontSize: 26, margin: "20px 0 8px" }}>LoomLend hit a snag</h1>
          <p style={{ opacity: 0.75, lineHeight: 1.5 }}>The app couldn&apos;t load. Try again in a moment; your bookings and history are safe.</p>
          <button
            onClick={() => retry()}
            style={{ marginTop: 20, padding: "10px 18px", borderRadius: 10, border: 0, background: "#4338ca", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
