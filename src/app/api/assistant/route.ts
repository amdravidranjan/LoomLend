import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { currentTime } from "@/lib/time";
import { runBasic } from "@/lib/assistant-basic";
import { ClaudeUnavailable, claudeAvailable, runClaude } from "@/lib/assistant-claude";
import type { StreamEvent } from "@/lib/assistant-types";
import type { ToolContext } from "@/lib/assistant";

// POST /api/assistant — streams the concierge's work as newline-delimited JSON (one StreamEvent per line).

export const maxDuration = 60;

const Body = z.object({
  message: z.string().trim().min(1, "Type a question first.").max(1000, "Please keep it under 1,000 characters."),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(40)
    .default([]),
});

// Simple per-user sliding window. Per server instance, which is enough to stop runaway loops and abuse.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;
const hits = new Map<string, number[]>();
function rateLimited(userId: string, now: number) {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(userId, recent);
    return Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
  }
  recent.push(now);
  hits.set(userId, recent);
  return 0;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please sign in to use the assistant." }, { status: 401 });
  const now = currentTime();
  const wait = rateLimited(user.id, now);
  if (wait) {
    return Response.json(
      { error: `You're sending messages quickly. Try again in ${wait} s.`, retryAfter: wait },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }
  let body: z.infer<typeof Body>;
  try {
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    body = parsed.data;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  // Keep the most recent turns only; older context rarely matters and costs tokens.
  const history = body.history.slice(-12).map((t) => ({ ...t, content: t.content.slice(0, 2000) }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          closed = true;
        }
      };
      const ctx: ToolContext = { user, now, purpose: body.message };
      try {
        if (claudeAvailable()) {
          try {
            emit({ type: "mode", mode: "claude" });
            const out = await runClaude(ctx, history, body.message, emit, request.signal);
            if (out.cards.length) emit({ type: "options", options: out.cards });
            emit({ type: "followups", items: out.followups });
          } catch (err) {
            if (!(err instanceof ClaudeUnavailable)) throw err;
            console.error(`Assistant falling back to basic mode: ${err.message}`);
            const note =
              err.reason === "rate_limit"
                ? "Claude is busy right now, so I'm using basic mode for this answer."
                : "Claude isn't reachable right now, so I'm using basic mode for this answer.";
            emit({ type: "mode", mode: "basic", note });
            await runBasic({ ...ctx, catalog: undefined }, history, body.message, emit);
          }
        } else {
          emit({ type: "mode", mode: "basic" });
          await runBasic(ctx, history, body.message, emit);
        }
      } catch (err) {
        if (request.signal.aborted) {
          closed = true;
        } else {
          console.error("Assistant failed", err);
          emit({ type: "error", message: "Something went wrong while I was checking. Please try again.", retryable: true });
        }
      }
      emit({ type: "done" });
      if (!closed) controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
