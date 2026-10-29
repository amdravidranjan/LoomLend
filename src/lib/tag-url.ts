// Client-safe: parse what a QR scanner returned into a LoomLend tag (no Node APIs here).

/** Pull resourceId + secret out of an absolute URL, a relative path, or return null for anything else. */
export function parseTagPayload(raw: string): { resourceId: string; secret: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), "https://loomlend.invalid");
  } catch {
    return null;
  }
  const m = url.pathname.match(/^\/scan\/([A-Za-z0-9_-]{1,80})\/?$/);
  const k = url.searchParams.get("k");
  if (!m || !k || !/^[A-Za-z0-9_-]{8,128}$/.test(k)) return null;
  return { resourceId: m[1], secret: k };
}

export function tagHref(t: { resourceId: string; secret: string }) {
  return `/scan/${encodeURIComponent(t.resourceId)}?k=${encodeURIComponent(t.secret)}`;
}
