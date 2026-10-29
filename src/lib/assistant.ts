import "server-only";
import { z } from "zod";
import { and, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking, Resource, User } from "@/db/schema";
import { AFFILIATIONS, BOOKING_HORIZON_DAYS, CERTS, MAX_OPEN_REQUESTS, STATUS_LABEL, STRIKE_LIMIT } from "./catalog";
import { matchResources } from "./match";
import { overlaps, parseList, type Check } from "./rules";
import { eligibilityFor } from "./workflow";
import { DAY, DAY_NAMES, fmtTime } from "./time";
import { PARTS_OF_DAY, addDays, dayKey, fmtDayKey, hhmm, type PartOfDay, type PolicyTopic } from "./assistant-parse";
import { findSlots, type SlotSearch } from "./assistant-slots";
import type { ApprovalPath, OptionCard, Requirement } from "./assistant-types";

// The concierge's tools. Both modes (Claude and the rule-based basic mode) call exactly these
// functions, so every resource, slot and requirement shown to the user comes from live data.

export type ToolContext = {
  user: User;
  now: number;
  /** The user's own words, used to pre-fill the request form's purpose. */
  purpose: string;
  purposeType?: Booking["purposeType"];
  catalog?: Resource[];
};

const CATEGORY = ["any", "space", "equipment", "tool", "device"] as const;
const PART = ["any", "morning", "afternoon", "evening"] as const;
export const POLICY_TOPICS = ["fair_share", "priority", "waitlist", "rounds", "supervision", "training", "strikes", "deposits", "horizon", "open_requests"] as const;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const TIME = z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM (24 h)")]);

export const toolInputs = {
  search_resources: z.object({ query: z.string().min(1).max(200), category: z.enum(CATEGORY) }),
  check_eligibility: z.object({ resource_id: z.string().min(1).max(80) }),
  find_free_slots: z.object({
    resource_id: z.string().min(1).max(80),
    from_date: DATE,
    to_date: DATE,
    duration_hours: z.number().min(0.5).max(12),
    part_of_day: z.enum(PART),
    earliest_start: TIME,
    latest_end: TIME,
  }),
  my_bookings: z.object({}),
  explain_policy: z.object({ topic: z.enum(POLICY_TOPICS) }),
  present_options: z.object({
    purpose: z.string().max(300),
    purpose_type: z.enum(["coursework", "research", "project", "personal"]),
    options: z
      .array(
        z.object({
          resource_id: z.string().min(1).max(80),
          date: DATE,
          start_time: z.string().regex(/^\d{2}:\d{2}$/),
          end_time: z.string().regex(/^\d{2}:\d{2}$/),
          why: z.string().max(240),
        }),
      )
      .max(6),
  }),
} as const;
export type ToolName = keyof typeof toolInputs;
export const TOOL_NAMES = Object.keys(toolInputs) as ToolName[];

// ------------------------------------------------------------------ data access

async function catalog(ctx: ToolContext) {
  if (!ctx.catalog) ctx.catalog = await db.select().from(schema.resources).where(ne(schema.resources.status, "retired"));
  return ctx.catalog;
}

export async function resourceById(ctx: ToolContext, id: string) {
  return (await catalog(ctx)).find((r) => r.id === id) ?? null;
}

async function bookingsIn(resourceId: string, from: number, to: number) {
  const rows = await db
    .select({ start: schema.bookings.start, end: schema.bookings.end, status: schema.bookings.status, userId: schema.bookings.userId })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.resourceId, resourceId),
        inArray(schema.bookings.status, ["approved", "checked_out", "returned", "pending", "waitlisted"]),
        lt(schema.bookings.start, to),
        gt(schema.bookings.end, from),
      ),
    );
  return {
    holders: rows.filter((b) => ["approved", "checked_out", "returned"].includes(b.status)),
    pending: rows.filter((b) => b.status === "pending"),
  };
}

async function userBookings(userId: string) {
  return db.select().from(schema.bookings).where(eq(schema.bookings.userId, userId));
}

// ------------------------------------------------------------------ shared formatting

export function slotLabel(start: number, end: number) {
  return `${fmtDayKey(dayKey(start))}, ${fmtTime(start)} – ${fmtTime(end)}`;
}

function openHoursText(r: Resource) {
  const days = parseList<number>(r.openDays);
  const span =
    days.length === 7 ? "every day" : days.join(",") === "1,2,3,4,5" ? "Mon–Fri" : days.join(",") === "1,2,3,4,5,6" ? "Mon–Sat" : days.map((d) => DAY_NAMES[d]).join(", ");
  return `${span}, ${r.openHour}:00–${r.closeHour}:00`;
}

const HREF: Record<string, string> = { identity: "/profile", standing: "/profile", "open-requests": "/bookings" };

function toRequirement(c: Check): Requirement {
  const isCert = c.key.startsWith("cert:");
  let fix = c.pass ? undefined : c.fixHint;
  if (!c.pass && isCert) {
    fix = c.detail.startsWith("Submitted")
      ? "Already submitted. A department manager needs to verify it; nothing else to do."
      : "Add the training record on your Profile; a department manager verifies it.";
  }
  if (!c.pass && c.key === "affiliation") fix = "This resource is not open to your membership type. Ask the owner about a supervised exception.";
  if (!c.pass && c.key === "fair-share") fix = "Pick a shorter session or a day further from your other bookings on this resource.";
  if (!c.pass && c.key === "resource") fix = "It is out of service right now; try a similar resource.";
  return { label: c.label, met: c.pass, detail: c.detail, fix, href: c.pass ? undefined : isCert ? "/profile" : HREF[c.key] };
}

function approvalPath(r: Resource, eligible: boolean, held: boolean, contested: boolean): { path: ApprovalPath; label: string; detail: string } {
  const deposit = r.depositRequired ? ` A ₹${r.depositRequired.toLocaleString("en-IN")} deposit is recorded at pick-up (not charged online).` : "";
  if (!eligible) return { path: "blocked", label: "Not requestable yet", detail: "Fix the missing requirements below, then request the slot." };
  if (held)
    return {
      path: "waitlist",
      label: "Joins the waiting list",
      detail: "This slot is already approved for someone else. Requesting it puts you on the waiting list, and you move up automatically if it frees.",
    };
  if (r.allocationMode === "rounds")
    return {
      path: "draw",
      label: "Fair draw entry",
      detail: `High-demand resource: requests for a day close ${r.roundLeadHours} h before it starts and slots are allocated by a published, weighted draw.${deposit}`,
    };
  if (r.supervisionRequired)
    return { path: "supervised", label: "Owner review · supervised", detail: `The owner reviews the request, and staff must be present at check-in.${deposit}` };
  if (r.autoApprove && !contested)
    return { path: "instant", label: "Instant approval", detail: `The owner allows instant booking: if every check passes when you request, it is approved straight away.${deposit}` };
  return {
    path: "review",
    label: "Owner review",
    detail: `The owner reviews the request${contested ? "; others asked for overlapping time, so the published priority score orders the requests" : ""}.${deposit}`,
  };
}

/** "I need to film an interview Friday afternoon" -> "Film an interview Friday afternoon". */
export function cleanPurpose(text: string) {
  const t = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hi|hey|hello)[,!.\s]+/i, "")
    .replace(/^(please\s+)?(can|could) (you|i)\s+(please\s+)?(help me\s+)?(find|book|get|use)?\s*/i, "")
    .replace(/^(i|we) (really )?(need|want|would like|'d like|have) to\s+/i, "")
    .replace(/^(i|we) (need|want)\s+/i, "")
    .replace(/[?]+$/, "");
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

export function requestHref(resourceId: string, start: number, end: number, purpose: string, purposeType?: string) {
  const p = new URLSearchParams({ date: dayKey(start), from: hhmm(minutesOf(start)), to: hhmm(minutesOf(end)) });
  const clean = cleanPurpose(purpose).slice(0, 200);
  if (clean) p.set("purpose", clean);
  if (purposeType) p.set("purposeType", purposeType);
  return `/resources/${resourceId}?${p.toString()}`;
}

function minutesOf(ms: number) {
  const d = new Date(ms + 5.5 * 3_600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Build a validated option card. Re-checks eligibility and the slot against live data. */
export async function buildOption(ctx: ToolContext, r: Resource, start: number, end: number, why: string): Promise<OptionCard> {
  const elig = await eligibilityFor(ctx.user, r, { start, end });
  const { holders, pending } = await bookingsIn(r.id, start, end);
  const held = holders.some((h) => overlaps(h, { start, end }));
  const contested = pending.some((p) => p.userId !== ctx.user.id && overlaps(p, { start, end }));
  // A held slot fails no eligibility check: requesting it simply joins the waiting list.
  const path = approvalPath(r, elig.eligible, held, contested);
  const reqs = elig.checks.map(toRequirement).filter((q) => !q.met || q.label.startsWith("Training") || q.label.startsWith("Fair-share"));
  return {
    resourceId: r.id,
    resourceName: r.name,
    emoji: r.emoji,
    location: r.location,
    department: r.department,
    start,
    end,
    slotLabel: slotLabel(start, end),
    why: why.trim().slice(0, 240),
    requirements: reqs,
    eligible: elig.eligible,
    path: path.path,
    pathLabel: path.label,
    pathDetail: path.detail,
    contested,
    requestHref: requestHref(r.id, start, end, ctx.purpose, ctx.purposeType),
  };
}

// ------------------------------------------------------------------ tools

export async function searchResources(ctx: ToolContext, input: z.infer<typeof toolInputs.search_resources>) {
  const all = (await catalog(ctx)).filter((r) => input.category === "any" || r.category === input.category);
  const matches = matchResources(input.query, all).slice(0, 5);
  if (!matches.length || matches[0].score === 0) {
    return {
      matches: [],
      note: "No resource matched those words. Try different words, or pick from what campus shares.",
      catalog: all.slice(0, 12).map((r) => ({ id: r.id, name: r.name, category: r.category })),
    };
  }
  const top = matches[0].score;
  return {
    matches: matches
      .filter((m) => m.score >= top * 0.25)
      .map(({ r, reasons }) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        department: r.department,
        location: r.location,
        status: r.status,
        matched_on: reasons,
        open: openHoursText(r),
        max_hours_per_booking: r.maxHours,
        weekly_cap_hours: r.weeklyHourCap,
        required_training: parseList(r.requiredCerts).map((k) => CERTS[k]?.label ?? k),
        approval: r.allocationMode === "rounds" ? "fair draw" : r.supervisionRequired ? "owner review + supervised" : r.autoApprove ? "instant if no competing request" : "owner review",
      })),
  };
}

export async function checkEligibility(ctx: ToolContext, input: z.infer<typeof toolInputs.check_eligibility>) {
  const r = await resourceById(ctx, input.resource_id);
  if (!r) return { error: `No resource with id "${input.resource_id}". Use an id from search_resources.` };
  const elig = await eligibilityFor(ctx.user, r);
  const reqs = elig.checks.map(toRequirement);
  return {
    resource: r.name,
    eligible: elig.eligible,
    missing: reqs.filter((q) => !q.met).map((q) => ({ requirement: q.label, detail: q.detail, fix: q.fix, link: q.href })),
    met: reqs.filter((q) => q.met).map((q) => q.label),
    supervised: r.supervisionRequired,
    note: elig.eligible ? "Profile requirements met. Time-window checks (hours, cap, open requests) run per slot." : "Not eligible until the missing items are fixed.",
  };
}

export async function freeSlots(ctx: ToolContext, input: z.infer<typeof toolInputs.find_free_slots>) {
  const r = await resourceById(ctx, input.resource_id);
  if (!r) return { error: `No resource with id "${input.resource_id}".` };
  if (r.status !== "active") return { resource: r.name, slots: [], note: `This resource is currently ${r.status} and cannot be booked.` };
  const toMin = (t: string) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : undefined);
  const to = input.to_date < input.from_date ? input.from_date : input.to_date;
  const search = await runSlotSearch(ctx, r, {
    fromDate: input.from_date,
    toDate: to,
    durationHours: input.duration_hours,
    partOfDay: input.part_of_day === "any" ? undefined : input.part_of_day,
    earliestStart: toMin(input.earliest_start),
    latestEnd: toMin(input.latest_end),
  });
  return {
    resource: r.name,
    open: openHoursText(r),
    duration_hours: search.durationHours,
    ...(search.durationClamped ? { duration_note: `Max ${r.maxHours} h per booking, so slots are ${r.maxHours} h.` } : {}),
    slots: search.slots.map((s) => ({ date: dayKey(s.start), start_time: hhmm(minutesOf(s.start)), end_time: hhmm(minutesOf(s.end)), label: slotLabel(s.start, s.end), others_requested_overlap: s.contested })),
    taken_by_others: search.heldWindows.slice(0, 4).map((h) => slotLabel(h.start, h.end)),
    ...(search.ownHeld.length ? { you_already_hold: search.ownHeld.map((h) => slotLabel(h.start, h.end)) } : {}),
    ...(search.takenSlots.length && !search.slots.length
      ? { waitlist_possible: { date: dayKey(search.takenSlots[0].start), start_time: hhmm(minutesOf(search.takenSlots[0].start)), end_time: hhmm(minutesOf(search.takenSlots[0].end)) } }
      : {}),
    ...(search.capBlocked ? { fair_share_note: `${search.capBlocked} otherwise-free slot(s) skipped: they would exceed your ${r.weeklyHourCap} h weekly cap here (${search.capRemainingHours} h left).` } : {}),
    ...(search.closedDays.length ? { closed_days: search.closedDays.map(fmtDayKey) } : {}),
    ...(search.beyondHorizon ? { horizon_note: `Bookings open at most ${BOOKING_HORIZON_DAYS} days ahead.` } : {}),
    ...(search.inPast ? { past_note: "Part of that window is already in the past." } : {}),
  };
}

export async function runSlotSearch(ctx: ToolContext, r: Resource, q: Parameters<typeof findSlots>[1]): Promise<SlotSearch & { ownHeld: { start: number; end: number }[] }> {
  const from = Math.max(ctx.now, Date.parse(`${q.fromDate}T00:00:00+05:30`));
  const to = Date.parse(`${addDays(q.toDate, 1)}T00:00:00+05:30`);
  const { holders, pending } = await bookingsIn(r.id, from - DAY, to + DAY);
  const mine = await userBookings(ctx.user.id);
  const search = findSlots(r, q, {
    now: ctx.now,
    holders,
    pending: pending.filter((p) => p.userId !== ctx.user.id),
    userBookings: mine,
  });
  // The person's own approved bookings block the window too, but they are not "someone else's".
  const own = holders.filter((h) => h.userId === ctx.user.id);
  const ownHeld = own.filter((h) => search.heldWindows.some((w) => w.start === h.start && w.end === h.end)).map((h) => ({ start: h.start, end: h.end }));
  const notMine = (x: { start: number; end: number }) => !own.some((o) => overlaps(o, x));
  return { ...search, takenSlots: search.takenSlots.filter(notMine), heldWindows: search.heldWindows.filter(notMine), ownHeld };
}

export async function myBookings(ctx: ToolContext) {
  const rows = await db
    .select({ b: schema.bookings, name: schema.resources.name })
    .from(schema.bookings)
    .innerJoin(schema.resources, eq(schema.resources.id, schema.bookings.resourceId))
    .where(and(eq(schema.bookings.userId, ctx.user.id), gt(schema.bookings.end, ctx.now - 2 * DAY)));
  const items = rows
    .filter((r) => ["pending", "approved", "waitlisted", "checked_out", "returned"].includes(r.b.status))
    .sort((a, b) => a.b.start - b.b.start)
    .map((r) => ({ id: r.b.id, resource: r.name, slot: slotLabel(r.b.start, r.b.end), status: STATUS_LABEL[r.b.status] ?? r.b.status, link: `/bookings/${r.b.id}` }));
  const open = rows.filter((r) => ["pending", "approved", "waitlisted"].includes(r.b.status) && r.b.end > ctx.now).length;
  return { bookings: items, open_requests: `${open} of ${MAX_OPEN_REQUESTS} open requests in use`, can_request_more: open < MAX_OPEN_REQUESTS };
}

export const POLICY_TEXT: Record<PolicyTopic, string> = {
  fair_share: "Fair-share cap: each resource has a weekly hour cap per person, counted over the 7 days either side of a slot, so one person cannot hold a busy machine all week. The cap is shown on every listing.",
  priority:
    "Priority score (published on /policy): base 50, +20 coursework, +15 research, +10 club/capstone project, +0 personal; +10 if you have not used the resource in 30 days, minus up to 30 for heavy recent use; −5 per no-show and −10 per strike. It only orders competing requests; a person still decides.",
  waitlist:
    "Waiting list: if you request a slot that is already approved for someone else, you join its waiting list with your priority score. If the booking is cancelled, the best-placed waiting request moves back to the owner for review automatically, and you are notified.",
  rounds:
    "Fair draw: for the busiest machines, requests for a day close ahead of time and the slots are allocated by a weighted, publicly verifiable draw. People who lose a draw get a fairness credit that boosts them next time.",
  supervision: "Supervised resources (e.g. the laser cutter and fume hood) need the owner or a manager present at check-in; you cannot self-check-in.",
  training: "Training: some resources need a verified training record. Add it on your Profile with evidence; a department manager verifies it. Pending records do not unlock the resource yet.",
  strikes: `Strikes: a manager may issue a strike after an incident (damage, late return, misuse). ${STRIKE_LIMIT} strikes suspend booking privileges until an administrator reviews the account. Each strike lowers priority by 10.`,
  deposits: "Deposits are recorded at pick-up for valuable kit (e.g. the camera kit and drone); LoomLend does not charge cards.",
  horizon: `You can book from now up to ${BOOKING_HORIZON_DAYS} days ahead.`,
  open_requests: `You can hold at most ${MAX_OPEN_REQUESTS} open (pending, approved or waiting) upcoming requests across all resources. Cancel one you no longer need to free a place.`,
};

export function explainPolicy(input: z.infer<typeof toolInputs.explain_policy>) {
  return { topic: input.topic, policy: POLICY_TEXT[input.topic], more: "/policy" };
}

/** Validate the model's proposed options against live data and turn them into cards. */
export async function presentOptions(ctx: ToolContext, input: z.infer<typeof toolInputs.present_options>) {
  ctx.purpose = input.purpose.trim().length >= 10 ? input.purpose : ctx.purpose;
  ctx.purposeType = input.purpose_type;
  const cards: OptionCard[] = [];
  const problems: string[] = [];
  for (const o of input.options.slice(0, 3)) {
    const r = await resourceById(ctx, o.resource_id);
    if (!r) {
      problems.push(`Unknown resource id ${o.resource_id}.`);
      continue;
    }
    const start = Date.parse(`${o.date}T${o.start_time}:00+05:30`);
    const end = Date.parse(`${o.date}T${o.end_time}:00+05:30`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      problems.push(`${r.name}: invalid time ${o.date} ${o.start_time}–${o.end_time}.`);
      continue;
    }
    const card = await buildOption(ctx, r, start, end, o.why);
    const hard = card.requirements.filter((q) => !q.met && ["Within opening hours", "Session length limit", "Booking window"].includes(q.label));
    if (hard.length) {
      problems.push(`${r.name} ${card.slotLabel}: ${hard.map((h) => `${h.label} (${h.detail})`).join("; ")}. Use find_free_slots.`);
      continue;
    }
    cards.push(card);
  }
  return { cards, problems };
}

// ------------------------------------------------------------------ dispatch + step labels

export type ToolOutcome = { result: unknown; isError: boolean; cards?: OptionCard[] };

export async function runTool(ctx: ToolContext, name: string, raw: unknown): Promise<ToolOutcome> {
  if (!(TOOL_NAMES as string[]).includes(name)) return { result: { error: `Unknown tool ${name}` }, isError: true };
  const parsed = toolInputs[name as ToolName].safeParse(raw ?? {});
  if (!parsed.success) return { result: { error: "Invalid input", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, isError: true };
  const input = parsed.data;
  switch (name as ToolName) {
    case "search_resources":
      return { result: await searchResources(ctx, input as z.infer<typeof toolInputs.search_resources>), isError: false };
    case "check_eligibility": {
      const res = await checkEligibility(ctx, input as z.infer<typeof toolInputs.check_eligibility>);
      return { result: res, isError: "error" in res };
    }
    case "find_free_slots": {
      const res = await freeSlots(ctx, input as z.infer<typeof toolInputs.find_free_slots>);
      return { result: res, isError: "error" in res };
    }
    case "my_bookings":
      return { result: await myBookings(ctx), isError: false };
    case "explain_policy":
      return { result: explainPolicy(input as z.infer<typeof toolInputs.explain_policy>), isError: false };
    case "present_options": {
      const { cards, problems } = await presentOptions(ctx, input as z.infer<typeof toolInputs.present_options>);
      return {
        result: { shown_to_user: cards.map((c) => `${c.resourceName} · ${c.slotLabel} · ${c.pathLabel}${c.eligible ? "" : " (not eligible yet)"}`), problems },
        isError: cards.length === 0 && problems.length > 0,
        cards,
      };
    }
  }
}

const POLICY_LABEL: Record<PolicyTopic, string> = {
  fair_share: "fair-share cap",
  priority: "priority score",
  waitlist: "waiting list",
  rounds: "fair-draw",
  supervision: "supervision",
  training: "training",
  strikes: "strikes",
  deposits: "deposit",
  horizon: "booking window",
  open_requests: "open-request limit",
};

/** Friendly, privacy-safe step labels shown in the chat while tools run. */
export async function describeToolCall(ctx: ToolContext, name: string, raw: unknown): Promise<string> {
  const i = (raw ?? {}) as Record<string, string | number>;
  const rname = async () => (typeof i.resource_id === "string" ? ((await resourceById(ctx, i.resource_id))?.name.split(" · ")[0] ?? "that resource") : "that resource");
  switch (name) {
    case "search_resources":
      return `Searching campus resources for “${String(i.query ?? "").slice(0, 60)}”`;
    case "check_eligibility":
      return `Checking your training and access for ${await rname()}`;
    case "find_free_slots": {
      const from = String(i.from_date ?? "");
      const to = String(i.to_date ?? from);
      const days = from && to && from !== to ? `${fmtDayKey(from)} – ${fmtDayKey(to)}` : from ? fmtDayKey(from) : "the next few days";
      const part = typeof i.part_of_day === "string" && i.part_of_day !== "any" ? (i.part_of_day as PartOfDay) : null;
      const window = i.earliest_start || i.latest_end ? ` ${i.earliest_start || "open"}–${i.latest_end || "close"}` : part ? ` ${part} (${PARTS_OF_DAY[part][0]}:00–${PARTS_OF_DAY[part][1]}:00)` : "";
      return `Looking at ${days}${window} on ${await rname()}`;
    }
    case "my_bookings":
      return "Reading your current bookings";
    case "explain_policy":
      return `Looking up the ${POLICY_LABEL[i.topic as PolicyTopic] ?? "booking"} policy`;
    case "present_options":
      return "Double-checking the options against live availability";
    default:
      return "Working";
  }
}

export function summariseToolResult(name: string, out: ToolOutcome): string {
  const r = out.result as Record<string, unknown>;
  if (out.isError) return typeof r?.error === "string" ? r.error : "Could not complete that step";
  switch (name) {
    case "search_resources": {
      const m = (r.matches as { name: string }[]) ?? [];
      return m.length ? `${m.length} match${m.length > 1 ? "es" : ""}: ${m.slice(0, 3).map((x) => x.name.split(" · ")[0]).join(", ")}` : "No matches";
    }
    case "check_eligibility": {
      const missing = (r.missing as { requirement: string }[]) ?? [];
      return missing.length ? `Missing: ${missing.map((x) => x.requirement.replace(/^Training: /, "")).join(", ")}` : "All requirements met";
    }
    case "find_free_slots": {
      const n = ((r.slots as unknown[]) ?? []).length;
      return n ? `${n} open slot${n > 1 ? "s" : ""}` : typeof r.note === "string" ? r.note : "Nothing free in that window";
    }
    case "my_bookings":
      return String(r.open_requests ?? "");
    case "explain_policy":
      return "Found it";
    case "present_options":
      return `${out.cards?.length ?? 0} option${out.cards?.length === 1 ? "" : "s"} ready`;
    default:
      return "Done";
  }
}

// ------------------------------------------------------------------ privacy-safe profile for the model

export async function requesterProfile(user: User, now: number) {
  const certs = await db.select().from(schema.certifications).where(eq(schema.certifications.userId, user.id));
  const open = await db
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.userId, user.id), inArray(schema.bookings.status, ["pending", "approved", "waitlisted"]), gt(schema.bookings.end, now)));
  return {
    affiliation: AFFILIATIONS[user.affiliation] ?? user.affiliation,
    department: user.department,
    id_verified: user.idVerified,
    verified_training: certs.filter((c) => c.status === "verified").map((c) => CERTS[c.certKey]?.label ?? c.certKey),
    pending_training: certs.filter((c) => c.status === "pending").map((c) => CERTS[c.certKey]?.label ?? c.certKey),
    standing: user.suspended ? "suspended" : `${user.strikes} of ${STRIKE_LIMIT} strikes`,
    open_requests: `${open.length} of ${MAX_OPEN_REQUESTS}`,
  };
}

export async function verifiedCertKeys(userId: string) {
  const certs = await db.select().from(schema.certifications).where(eq(schema.certifications.userId, userId));
  return certs.filter((c) => c.status === "verified").map((c) => c.certKey);
}

/** Next 14 campus dates with weekday names, so relative dates resolve correctly. */
export function calendarHint(now: number) {
  const today = dayKey(now);
  return Array.from({ length: 14 }, (_, i) => {
    const k = addDays(today, i);
    return `${fmtDayKey(k)} = ${k}${i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : ""}`;
  }).join("; ");
}
