import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { conditionLabel } from "./catalog";
import { reportIncident } from "./workflow";
import type { ConditionDiff, VisionResult } from "./vision-types";
import { aiKeySource, anthropicClient } from "./ai-key";

// Advisory photo comparison: Claude looks at the check-in and return photos and lists visible
// changes. It never decides anything. If it thinks a damage review is warranted and none exists,
// it opens one for a manager to decide. Without an API key the booking page falls back to a
// client-side pixel-difference heatmap (see components/handover-compare.tsx).

const MODEL = "claude-opus-5-5";
const TIMEOUT_MS = 30_000;
export async function visionEnabled() {
  return (await aiKeySource()) !== "none";
}

const SCHEMA = {
  type: "object",
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          area: { type: "string" },
          description: { type: "string" },
          severity: { type: "string", enum: ["none", "minor", "major"] },
        },
        required: ["area", "description", "severity"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    suggestsDamageReview: { type: "boolean" },
  },
  required: ["changes", "summary", "confidence", "suggestsDamageReview"],
  additionalProperties: false,
} as const;

const SYSTEM =
  "You compare two photos of the same piece of shared college equipment: BEFORE (taken by the borrower at check-in) and AFTER (taken at return). " +
  "List physical differences that matter for the item's condition: scratches, dents, cracks, chips, missing or added parts, stains, dirt, burn marks, bent pieces. " +
  "Ignore differences explained by lighting, white balance, camera angle, framing, background, blur or compression, and say so if that is all you see. " +
  "Use severity 'none' for cosmetic or photographic differences, 'minor' for wear that does not affect use, 'major' for damage that affects use, safety or value. " +
  "Set suggestsDamageReview to true only when a person should inspect for damage. Be factual and neutral: never assign blame, intent or penalties; a human manager decides. " +
  "If the photos do not seem to show the same item, say so in the summary, set confidence to low and suggestsDamageReview to true.";

type ImageMedia = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

function toImageBlock(dataUrl: string) {
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  return { type: "image" as const, source: { type: "base64" as const, media_type: m[1] as ImageMedia, data: m[2] } };
}

function isResult(x: unknown): x is VisionResult {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    Array.isArray(o.changes) &&
    typeof o.summary === "string" &&
    ["low", "medium", "high"].includes(String(o.confidence)) &&
    typeof o.suggestsDamageReview === "boolean"
  );
}

async function save(bookingId: string, diff: ConditionDiff) {
  await db.update(schema.bookings).set({ aiConditionDiff: JSON.stringify(diff) }).where(eq(schema.bookings.id, bookingId));
}

async function askClaude(client: Anthropic | null, before: string, after: string, context: string): Promise<{ ok: true; result: VisionResult } | { ok: false; message: string }> {
  if (!client) return { ok: false, message: "No API key configured." };
  const a = toImageBlock(before);
  const b = toImageBlock(after);
  if (!a || !b) return { ok: false, message: "A photo is not in a supported format." };
  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 2000,
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "BEFORE (check-in):" },
              a,
              { type: "text", text: "AFTER (return):" },
              b,
              { type: "text", text: context },
            ],
          },
        ],
      },
      { timeout: TIMEOUT_MS },
    );
    if (response.stop_reason === "refusal") return { ok: false, message: "The model declined to compare these photos." };
    if (response.stop_reason === "max_tokens") return { ok: false, message: "The comparison was cut short. Try again." };
    const text = response.content.find((c) => c.type === "text");
    if (!text || text.type !== "text") return { ok: false, message: "The model returned no comparison." };
    const parsed: unknown = JSON.parse(text.text);
    if (!isResult(parsed)) return { ok: false, message: "The comparison came back in an unexpected shape." };
    const changes = parsed.changes
      .filter((c) => c && typeof c.area === "string" && typeof c.description === "string")
      .slice(0, 8)
      .map((c) => ({ area: c.area.slice(0, 80), description: c.description.slice(0, 300), severity: (["none", "minor", "major"].includes(c.severity) ? c.severity : "minor") as VisionResult["changes"][number]["severity"] }));
    return { ok: true, result: { ...parsed, summary: parsed.summary.slice(0, 600), changes } };
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, message: "The comparison timed out after 30 seconds." };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, message: "The AI service is busy (rate limited). Try again in a minute." };
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      console.error("Vision comparison: API key rejected", err.status);
      return { ok: false, message: "The AI service rejected the API key." };
    }
    if (err instanceof Anthropic.BadRequestError) return { ok: false, message: "The photos could not be processed (bad request)." };
    if (err instanceof Anthropic.APIError) {
      console.error(`Vision comparison: API error ${err.status}: ${err.message}`);
      return { ok: false, message: `The AI service returned an error (${err.status ?? "network"}).` };
    }
    if (err instanceof SyntaxError) return { ok: false, message: "The comparison could not be read." };
    console.error("Vision comparison failed", err);
    return { ok: false, message: "The comparison failed unexpectedly." };
  }
}

/**
 * Compare the check-in and return photos of a booking and store the advisory result.
 * Safe to call more than once (a retry overwrites the previous result). Never throws.
 */
/** `apiKey` must be resolved by the caller when this runs after the response (no request cookies there). */
export async function compareConditionPhotos(bookingId: string, apiKey?: string | null): Promise<ConditionDiff | null> {
  try {
    const client = await anthropicClient({ timeout: TIMEOUT_MS, maxRetries: 1, apiKey });
    const b = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, bookingId) });
    if (!b || !b.checkOutPhoto || !b.returnPhoto) return null;
    const now = Date.now();
    if (!client) {
      const diff: ConditionDiff = { status: "unavailable", reason: "no_api_key", at: now };
      await save(b.id, diff);
      return diff;
    }
    const r = await db.query.resources.findFirst({ where: eq(schema.resources.id, b.resourceId) });
    const prev = parseDiff(b.aiConditionDiff);
    const attempts = (prev?.status === "error" ? prev.attempts : 0) + 1;
    await save(b.id, { status: "pending", requestedAt: now });

    const context =
      `Item: ${r?.name ?? "equipment"}. Borrower recorded condition at check-in: ${conditionLabel(b.checkOutCondition)}` +
      `${b.checkOutNotes ? ` ("${b.checkOutNotes.slice(0, 200)}")` : ""}; at return: ${conditionLabel(b.returnCondition)}` +
      `${b.returnNotes ? ` ("${b.returnNotes.slice(0, 200)}")` : ""}.`;
    const out = await askClaude(client, b.checkOutPhoto, b.returnPhoto, context);
    if (!out.ok) {
      const diff: ConditionDiff = { status: "error", message: out.message, at: Date.now(), attempts };
      await save(b.id, diff);
      await audit({ actorId: null, action: "booking.condition_compare_failed", entityType: "booking", entityId: b.id, details: { reason: out.message, attempt: attempts } });
      return diff;
    }

    let incidentId: string | null = null;
    if (out.result.suggestsDamageReview && r) {
      const existing = await db.query.incidents.findFirst({ where: and(eq(schema.incidents.bookingId, b.id), eq(schema.incidents.type, "damage")) });
      if (existing) incidentId = existing.id;
      else {
        const major = out.result.changes.some((c) => c.severity === "major");
        const list = out.result.changes.filter((c) => c.severity !== "none").map((c) => `${c.area}: ${c.description} (${c.severity})`).join("; ");
        incidentId = await reportIncident(
          null,
          {
            bookingId: b.id,
            resourceId: r.id,
            type: "damage",
            severity: major ? "medium" : "low",
            description: `Automatic photo comparison (Claude, advisory only) suggests a damage review. ${out.result.summary}${list ? ` Changes noted: ${list}.` : ""} Confidence: ${out.result.confidence}. A manager decides; the borrower can add their side.`,
          },
          true,
        );
      }
    }
    const diff: ConditionDiff = { status: "done", source: "claude", model: MODEL, ...out.result, comparedAt: Date.now(), incidentId };
    await save(b.id, diff);
    await audit({
      actorId: null,
      action: "booking.condition_compared",
      entityType: "booking",
      entityId: b.id,
      details: { summary: out.result.summary, confidence: out.result.confidence, suggestsReview: out.result.suggestsDamageReview, advisory: "Claude vision, never decides" },
    });
    return diff;
  } catch (err) {
    console.error("compareConditionPhotos failed", err);
    try {
      await save(bookingId, { status: "error", message: "The comparison failed unexpectedly.", at: Date.now(), attempts: 1 });
    } catch {}
    return null;
  }
}

export function parseDiff(s: string | null | undefined): ConditionDiff | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as ConditionDiff;
  } catch {
    return null;
  }
}
