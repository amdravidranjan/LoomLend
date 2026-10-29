import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";

// Bring-your-own-key: a visitor (e.g. a judge) may paste their own Claude API key. It lives only in
// their browser, in an encrypted httpOnly cookie that expires when the browser session ends; the
// server reads it per request and never stores or logs it. The deployment's own ANTHROPIC_API_KEY,
// if set, always takes precedence. With neither, every AI feature uses its rule-based fallback.

const COOKIE = "ll_ai_key";
const secret = createHash("sha256")
  .update(process.env.SESSION_SECRET ?? "loomlend-dev-secret-change-me-in-production")
  .update("|byok")
  .digest();

export type KeySource = "server" | "visitor" | "none";

function seal(key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const body = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

function unseal(token: string) {
  const [iv, tag, body] = token.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", secret, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/** The visitor's key from their cookie, if any. Safe to call outside a request (returns null). */
async function visitorKey(): Promise<string | null> {
  try {
    const token = (await cookies()).get(COOKIE)?.value;
    return token ? unseal(token) : null;
  } catch {
    return null; // no request scope (e.g. background work), or a tampered/stale cookie
  }
}

/** The key to use for this request, and where it came from. */
export async function resolveApiKey(): Promise<{ key: string | null; source: KeySource }> {
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: "server" };
  const key = await visitorKey();
  return key ? { key, source: "visitor" } : { key: null, source: "none" };
}

export async function aiKeySource(): Promise<KeySource> {
  return (await resolveApiKey()).source;
}

/** A client for this request, or null when no key is available (callers then use their fallback). */
export async function anthropicClient(opts: { timeout: number; maxRetries: number; apiKey?: string | null }) {
  const key = opts.apiKey ?? (await resolveApiKey()).key;
  return key ? new Anthropic({ apiKey: key, timeout: opts.timeout, maxRetries: opts.maxRetries }) : null;
}

export function looksLikeKey(key: string) {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key);
}

/** Checks the key with one cheap, read-only API call (listing a single model). */
export async function testKey(key: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await new Anthropic({ apiKey: key, timeout: 10_000, maxRetries: 0 }).models.list({ limit: 1 });
    return { ok: true };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, message: "Anthropic rejected this key. Check it was copied in full." };
    if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, message: "This key doesn't have permission to use the API." };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, message: "The key is rate limited right now. Try again in a minute." };
    if (err instanceof Anthropic.APIError) return { ok: false, message: `Anthropic returned an error (${err.status ?? "network"}). Try again.` };
    return { ok: false, message: "Couldn't reach Anthropic to check the key. Try again." };
  }
}

export async function storeVisitorKey(key: string) {
  (await cookies()).set(COOKIE, seal(key), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    // No maxAge: a session cookie, gone when the browser closes.
  });
}

export async function clearVisitorKey() {
  (await cookies()).delete(COOKIE);
}
