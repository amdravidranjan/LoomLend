import "server-only";
import type { Resource } from "@/db/schema";
import { matchResources } from "./match";
import { db, schema } from "@/db";
import { parseList } from "./rules";
import { addDays, dayKey, describeIntent, fmtDayKey, fmtMinutes, mergeIntent, parseIntent, type Intent } from "./assistant-parse";
import type { FoundSlot } from "./assistant-slots";
import type { ChatTurn, OptionCard, StreamEvent } from "./assistant-types";
import {
  POLICY_TEXT,
  buildOption,
  describeToolCall,
  runSlotSearch,
  runTool,
  slotLabel,
  summariseToolResult,
  type ToolContext,
} from "./assistant";

// Basic mode: a deterministic planner that calls the same tools Claude would, in a fixed order.
// Used when there is no API key, or as a graceful fallback when the Claude call fails.

type Emit = (e: StreamEvent) => void;

async function step<T>(emit: Emit, ctx: ToolContext, id: string, name: string, input: unknown, run: () => Promise<T>, summary?: (r: T) => string) {
  emit({ type: "step", id, label: await describeToolCall(ctx, name, input), status: "running" });
  const r = await run();
  emit({ type: "step", id, label: await describeToolCall(ctx, name, input), status: "done", detail: summary?.(r) });
  return r;
}

export async function runBasic(ctx: ToolContext, history: ChatTurn[], message: string, emit: Emit) {
  const now = ctx.now;
  const all = (await db.select().from(schema.resources)).filter((r) => r.status !== "retired");
  ctx.catalog = all;

  // Fold earlier user turns so follow-ups ("make it 3 hours", "what about Saturday?") keep context.
  let prev: Intent | null = null;
  let need = "";
  for (const t of history.filter((h) => h.role === "user")) {
    const i = parseIntent(t.content, now);
    if (i.kind !== "find") continue;
    const hits = i.query ? matchResources(i.query, all).length > 0 : false;
    prev = mergeIntent(prev, i, hits);
    if (hits) need = t.content;
  }
  const cur = parseIntent(message, now);
  const curHits = cur.query ? matchResources(cur.query, all).length > 0 : false;
  const intent = cur.kind === "find" ? mergeIntent(prev, cur, curHits) : cur;
  if (curHits) need = message;
  ctx.purpose = need.trim().length >= 10 ? need.trim() : "";
  ctx.purposeType = intent.purposeType;

  emit({ type: "step", id: "parse", label: "Reading your request", status: "done", detail: describeIntent(intent) });

  if (intent.kind === "my_bookings") {
    const out = await step(emit, ctx, "s1", "my_bookings", {}, () => runTool(ctx, "my_bookings", {}), undefined);
    const r = out.result as { bookings: { resource: string; slot: string; status: string }[]; open_requests: string };
    const lines = r.bookings.length
      ? r.bookings.map((b) => `• ${b.resource.split(" · ")[0]} — ${b.slot} (${b.status})`).join("\n")
      : "You have no upcoming bookings.";
    emit({ type: "text", delta: `${lines}\n\n${r.open_requests}. Open any of them from My bookings.` });
    emit({ type: "followups", items: ["How does the waiting list work?", "Find me a 3D printer slot tomorrow", "What's the fair-share cap?"] });
    return;
  }

  if (intent.kind === "policy" && intent.policyTopic) {
    await step(emit, ctx, "s1", "explain_policy", { topic: intent.policyTopic }, async () => runTool(ctx, "explain_policy", { topic: intent.policyTopic }));
    emit({ type: "text", delta: `${POLICY_TEXT[intent.policyTopic]}\n\nThe full rules are on the Policy page.` });
    emit({ type: "followups", items: ["How is priority decided?", "What have I booked?", "I need to film an interview Friday afternoon"] });
    return;
  }

  if (!intent.query) {
    emit({
      type: "text",
      delta:
        "Tell me what you need to do and roughly when, and I'll find something you can request. For example: “cut acrylic panels Thursday morning” or “a room for a team meeting tomorrow at 3 pm for an hour”.",
    });
    emit({ type: "followups", items: ["I need to film an interview Friday afternoon", "GPU for training a model tomorrow, 4 hours", "A meeting room tomorrow at 3pm"] });
    return;
  }

  const search = await step(
    emit,
    ctx,
    "s1",
    "search_resources",
    { query: intent.query },
    () => runTool(ctx, "search_resources", { query: intent.query, category: intent.category ?? "any" }),
    (o) => summariseToolResult("search_resources", o),
  );
  const matches = ((search.result as { matches: { id: string }[] }).matches ?? []).map((m) => all.find((r) => r.id === m.id)!).filter(Boolean);
  if (!matches.length) {
    const names = all.filter((r) => r.status === "active").slice(0, 6).map((r) => r.name.split(" · ")[0]);
    emit({
      type: "text",
      delta: `I couldn't find a campus resource for “${intent.query}”. Here is what departments currently share: ${names.join(", ")}, and more on Discover. Try describing the task (“record a podcast”, “solder a PCB”).`,
    });
    emit({ type: "followups", items: names.slice(0, 3).map((n) => `Book the ${n} tomorrow`) });
    return;
  }

  const scored = matchResources(intent.query, matches);
  const focus = scored.length === 1 || scored[0].score >= 2 * (scored[1]?.score ?? 0);
  const candidates = (focus ? [scored[0].r] : scored.slice(0, 3).map((m) => m.r)) as Resource[];

  const from = intent.fromDate ?? dayKey(now);
  const to = intent.toDate ?? addDays(from, intent.fromDate ? 0 : 6);
  const notes: string[] = [];
  const per: Candidate[] = [];

  let n = 2;
  for (const r of candidates) {
    if (r.status !== "active") {
      notes.push(`${r.name.split(" · ")[0]} is in ${r.status} right now, so it can't be booked.`);
      continue;
    }
    const elig = await step(emit, ctx, `s${n++}`, "check_eligibility", { resource_id: r.id }, () => runTool(ctx, "check_eligibility", { resource_id: r.id }), (o) =>
      summariseToolResult("check_eligibility", o),
    );
    const e = elig.result as { eligible: boolean; missing: { requirement: string; detail: string }[] };
    const dur = intent.durationHours ?? Math.min(2, r.maxHours);
    if (intent.durationHours && intent.durationHours > r.maxHours) notes.push(`${r.name.split(" · ")[0]} allows at most ${r.maxHours} h per booking, so I used ${r.maxHours} h slots.`);
    const q = {
      fromDate: from,
      toDate: to,
      durationHours: dur,
      partOfDay: intent.partOfDay,
      earliestStart: intent.startMinutes,
      latestEnd: intent.endMinutes,
      exactStart: intent.exactStart,
    };
    const label = { resource_id: r.id, from_date: from, to_date: to, part_of_day: intent.partOfDay ?? "any", earliest_start: intent.startMinutes !== undefined ? fmtMinutes(intent.startMinutes) : "", latest_end: intent.endMinutes !== undefined ? fmtMinutes(intent.endMinutes) : "" };
    let found = await step(emit, ctx, `s${n++}`, "find_free_slots", label, () => runSlotSearch(ctx, r, q), (s) => (s.slots.length ? `${s.slots.length} open slot${s.slots.length > 1 ? "s" : ""}` : "Nothing free in that window"));
    let widened = false;
    const waitlist = found.takenSlots[0];
    if (found.capBlocked && !found.slots.length) notes.push(`Some ${r.name.split(" · ")[0]} slots were skipped: they'd take you over your fair-share cap there (${found.capRemainingHours} h left this week).`);
    if (found.ownHeld.length) notes.push(`You already hold ${r.name.split(" · ")[0]} ${found.ownHeld.map((h) => slotLabel(h.start, h.end)).join(" and ")}; it's on My bookings.`);
    if (found.closedDays.length && !found.slots.length) notes.push(`${r.name.split(" · ")[0]} is closed on ${found.closedDays.map(fmtDayKey).join(", ")}.`);
    if (!found.slots.length) {
      // Nearest alternatives: any time of day, over the following week.
      const wider = { fromDate: from, toDate: addDays(to, 7), durationHours: Math.min(dur, r.maxHours) };
      const label2 = { resource_id: r.id, from_date: from, to_date: wider.toDate, part_of_day: "any" };
      found = await step(emit, ctx, `s${n++}`, "find_free_slots", label2, () => runSlotSearch(ctx, r, wider), (s) => (s.slots.length ? `${s.slots.length} nearby slot${s.slots.length > 1 ? "s" : ""}` : "Still nothing"));
      widened = true;
    }
    const missing = (e.missing ?? []).map((m) => m.requirement);
    // A membership or standing block can't be fixed by the person, so don't dangle slots they can never request.
    const permanent = missing.some((m) => m === "Membership allowed" || m === "Account in good standing");
    const pending = (e.missing ?? []).filter((m) => m.requirement.startsWith("Training") && m.detail.startsWith("Submitted")).map((m) => m.requirement);
    per.push({ r, eligible: e.eligible, missing, pending, permanent, slots: permanent ? [] : found.slots, widened, waitlist: permanent ? undefined : waitlist });
  }

  // Pick up to 3 options: eligible resources first, best slots first, varied across resources.
  const picks: { r: Resource; slot: { start: number; end: number }; why: string }[] = [];
  const order = [...per].sort((a, b) => Number(b.eligible) - Number(a.eligible));
  for (let round = 0; round < 3 && picks.length < 3; round++) {
    for (const p of order) {
      const s = p.slots[round];
      if (s && picks.length < 3) picks.push({ r: p.r, slot: s, why: whyText(p.r, intent, p.widened, p.eligible) });
    }
  }
  const cards: OptionCard[] = [];
  for (const p of picks) cards.push(await buildOption(ctx, p.r, p.slot.start, p.slot.end, p.why));
  // Everything taken? Offer the waiting list on the exact slot that was asked for.
  const full = per.find((p) => p.eligible && p.waitlist);
  if (full && !per.some((p) => p.eligible && p.slots.length && !p.widened) && cards.length < 3) {
    cards.unshift(await buildOption(ctx, full.r, full.waitlist!.start, full.waitlist!.end, "The time you asked for is taken. Request it anyway to join the waiting list; you're notified if it frees."));
  }

  emit({ type: "step", id: "verify", label: "Double-checking the options against live availability", status: "done", detail: `${cards.length} option${cards.length === 1 ? "" : "s"} ready` });
  const openToYou = all
    .filter((r) => r.status === "active" && parseList(r.allowedAffiliations).includes(ctx.user.affiliation) && (!r.requiresIdVerified || ctx.user.idVerified))
    .filter((r) => parseList(r.requiredCerts).length === 0 && !candidates.some((c) => c.id === r.id))
    .map((r) => r.name.split(" · ")[0]);
  emit({ type: "text", delta: compose(intent, per, cards, notes, openToYou) });
  if (cards.length) emit({ type: "options", options: cards.slice(0, 3) });
  emit({ type: "followups", items: followups(intent, per, cards, now) });
}

function whyText(r: Resource, intent: Intent, widened: boolean, eligible: boolean) {
  const bits: string[] = [];
  const reasons = matchResources(intent.query, [r])[0]?.reasons ?? [];
  const direct = reasons.filter((x) => !x.includes("→"));
  bits.push(direct.length ? `Matches “${direct.slice(0, 2).join("”, “")}”` : `Suited to “${intent.query}”`);
  if (widened) bits.push("the nearest free time to what you asked for");
  else if (intent.fromDate || intent.partOfDay || intent.startMinutes !== undefined) bits.push("fits the time you asked for");
  if (!eligible) bits.push("requestable once the missing training is verified");
  return `${bits.join("; ")}.`;
}

type Candidate = { r: Resource; eligible: boolean; missing: string[]; pending: string[]; permanent: boolean; slots: FoundSlot[]; widened: boolean; waitlist?: { start: number; end: number } };

/** Plain-English version of an unmet requirement. */
function blocker(label: string) {
  if (label.startsWith("Training: ")) return `${label.slice(10)} training`;
  if (label === "Campus identity verified") return "a verified campus ID (the facilities office does this)";
  if (label === "Membership allowed") return "a membership type it is open to";
  if (label === "Account in good standing") return "booking privileges (they are currently suspended)";
  if (label === "Resource available for booking") return "the resource to be back in service";
  return label.toLowerCase();
}
const short = (r: Resource) => r.name.split(" · ")[0];
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function compose(intent: Intent, per: Candidate[], cards: OptionCard[], notes: string[], openToYou: string[]) {
  const when = [intent.dateLabel, intent.partOfDay].filter(Boolean).join(" ");
  const parts: string[] = [];
  const eligible = per.filter((p) => p.eligible);
  const blocked = per.filter((p) => !p.eligible);
  const trainingTip = "Add the training record on your Profile; once a department manager verifies it, the resource unlocks straight away.";
  if (!per.length) parts.push("None of the matching resources can be booked right now.");
  else if (!eligible.length) {
    const p = per[0];
    if (p.permanent) {
      parts.push(`${short(p.r)} isn't open to your membership type${p.missing.includes("Campus identity verified") ? ", and your campus ID isn't verified yet" : ""}, so I can't offer slots on it.`);
      if (openToYou.length) parts.push(`Resources open to you include ${list(openToYou.slice(0, 3))}. The owner can also tell you about supervised exceptions.`);
    } else {
      parts.push(`You can't request ${short(p.r)} yet: it needs ${list(p.missing.map(blocker))}.`);
      const toAdd = p.missing.filter((m) => m.startsWith("Training") && !p.pending.includes(m));
      if (p.pending.length)
        parts.push(`Your ${list(p.pending.map((m) => m.slice(10)))} record is submitted and waiting for a department manager to verify it; the resource unlocks as soon as they do.`);
      if (toAdd.length) parts.push(trainingTip);
      if (cards.length) parts.push("Here's what you could request once that's sorted.");
    }
  } else if (!cards.length) {
    parts.push(`Everything${when ? ` ${when}` : ""} is taken on ${eligible.map((p) => p.r.name.split(" · ")[0]).join(" and ")}, and nothing frees up in the following week either. Try another day or a similar resource.`);
  } else if (eligible.every((p) => p.widened || !p.slots.length)) {
    parts.push(`Nothing is free${when ? ` ${when}` : ""}, so here are the nearest alternatives${cards.some((c) => c.path === "waitlist") ? ", plus the waiting list for the time you asked for" : ""}.`);
  } else {
    parts.push(`Here ${cards.length === 1 ? "is an option" : `are ${cards.length} options`}${when ? ` for ${when}` : ""}, checked against your training and live availability.`);
  }
  if (eligible.length && blocked.length) {
    const fixable = blocked.filter((p) => !p.permanent);
    if (fixable.length) parts.push(`${list(fixable.map((p) => short(p.r)))} ${fixable.length > 1 ? "need" : "needs"} ${list([...new Set(fixable.flatMap((p) => p.missing.map(blocker)))])}, which you don't have yet.`);
  }
  parts.push(...notes);
  if (cards.length) parts.push("Nothing is reserved until you request it, and approval is up to the owner unless the card says instant.");
  return parts.join(" ");
}

function followups(intent: Intent, per: Candidate[], cards: OptionCard[], now: number) {
  const out: string[] = [];
  const base = intent.fromDate ?? dayKey(now);
  const next = addDays(base, 1);
  if (cards.length) out.push(`What about ${fmtDayKey(next)} instead?`);
  const dur = intent.durationHours ?? 2;
  if (cards.length && per[0] && dur < per[0].r.maxHours) out.push(`Make it ${dur + 1} hours`);
  if (per.some((p) => !p.eligible && p.missing.some((m) => m.startsWith("Training")))) out.push("How does training verification work?");
  if (cards.some((c) => c.path === "waitlist")) out.push("How does the waiting list work?");
  if (cards.some((c) => c.path === "draw")) out.push("How does the fair draw work?");
  const other = per.find((p) => p.slots.length && cards.every((c) => c.resourceId !== p.r.id));
  if (other) out.push(`Show the ${other.r.name.split(" · ")[0]} instead`);
  out.push("What have I booked?");
  return [...new Set(out)].slice(0, 4);
}

