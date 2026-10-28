// Pure, explainable rules for eligibility, fair use and request priority.
// Kept free of database access so they can be unit-tested and shown verbatim to users.
import type { Booking, Certification, Resource, User } from "@/db/schema";
import { AFFILIATIONS, BOOKING_HORIZON_DAYS, CERTS, MAX_OPEN_REQUESTS, STRIKE_LIMIT } from "./catalog";
import { DAY, DAY_NAMES, HOUR, campusDayAt, campusParts } from "./time";

export type Check = { key: string; label: string; pass: boolean; detail: string; fixHint?: string };
export type Eligibility = { eligible: boolean; checks: Check[]; needsSupervision: boolean };

const HOLDING: Booking["status"][] = ["pending", "approved", "checked_out", "returned", "closed"];
const OPEN: Booking["status"][] = ["pending", "approved", "waitlisted"];

export function parseList<T = string>(json: string): T[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Requirements that depend only on who the user is (no time window). */
export function profileChecks(user: User, resource: Resource, certs: Certification[]): Check[] {
  const checks: Check[] = [];
  checks.push({
    key: "standing",
    label: "Account in good standing",
    pass: !user.suspended && user.strikes < STRIKE_LIMIT,
    detail: user.suspended
      ? "Booking privileges are suspended pending admin review."
      : `${user.strikes} of ${STRIKE_LIMIT} strikes.`,
    fixHint: user.suspended ? "Contact the facilities office to request reinstatement." : undefined,
  });
  if (resource.requiresIdVerified) {
    checks.push({
      key: "identity",
      label: "Campus identity verified",
      pass: user.idVerified,
      detail: user.idVerified ? "ID card verified by the facilities office." : "Your ID has not been verified yet.",
      fixHint: user.idVerified ? undefined : "An administrator verifies your ID from the Admin desk.",
    });
  }
  const allowed = parseList(resource.allowedAffiliations);
  checks.push({
    key: "affiliation",
    label: "Membership allowed",
    pass: allowed.includes(user.affiliation),
    detail: `Open to: ${allowed.map((a) => AFFILIATIONS[a] ?? a).join(", ")}. You are: ${AFFILIATIONS[user.affiliation] ?? user.affiliation}.`,
  });
  for (const key of parseList(resource.requiredCerts)) {
    const rec = certs.find((c) => c.certKey === key && c.userId === user.id);
    const label = CERTS[key]?.label ?? key;
    checks.push({
      key: `cert:${key}`,
      label: `Training: ${label}`,
      pass: rec?.status === "verified",
      detail:
        rec?.status === "verified"
          ? "Verified training record on file."
          : rec?.status === "pending"
            ? "Submitted, waiting for a manager to verify."
            : rec?.status === "rejected"
              ? `Rejected: ${rec.reviewNote ?? "no reason given"}.`
              : "No training record on file.",
      fixHint: rec?.status === "verified" ? undefined : "Add the training record from your profile.",
    });
  }
  checks.push({
    key: "resource",
    label: "Resource available for booking",
    pass: resource.status === "active",
    detail: resource.status === "active" ? "Listed and in service." : `Currently ${resource.status}.`,
  });
  return checks;
}

/** Hours already held by the user on this resource in the 7 days around `start`. */
export function weeklyHours(userBookings: Booking[], resourceId: string, start: number, excludeId?: string) {
  const from = start - 7 * DAY;
  const to = start + 7 * DAY;
  return userBookings
    .filter((b) => b.resourceId === resourceId && b.id !== excludeId && HOLDING.includes(b.status) && b.start >= from && b.start < to)
    .reduce((h, b) => h + (b.end - b.start) / HOUR, 0);
}

export function windowChecks(
  user: User,
  resource: Resource,
  start: number,
  end: number,
  userBookings: Booking[],
  now = Date.now(),
  excludeId?: string,
): Check[] {
  const checks: Check[] = [];
  const days = parseList<number>(resource.openDays);
  const sp = campusParts(start);
  const ep = campusParts(end);
  const sameDay = sp.year === ep.year && sp.month === ep.month && sp.day === ep.day;
  const withinHours =
    sameDay &&
    days.includes(sp.weekday) &&
    start >= campusDayAt(start, resource.openHour) &&
    end <= campusDayAt(start, resource.closeHour);
  checks.push({
    key: "hours",
    label: "Within opening hours",
    pass: end > start && withinHours,
    detail: `${days.map((d) => DAY_NAMES[d]).join(", ")}, ${resource.openHour}:00–${resource.closeHour}:00 (campus time), same day.`,
  });
  const hours = (end - start) / HOUR;
  checks.push({
    key: "duration",
    label: "Session length limit",
    pass: hours > 0 && hours <= resource.maxHours,
    detail: `${hours.toFixed(1)} h requested, max ${resource.maxHours} h per booking.`,
  });
  checks.push({
    key: "horizon",
    label: "Booking window",
    pass: start > now - 15 * 60_000 && start < now + BOOKING_HORIZON_DAYS * DAY,
    detail: `Book from now up to ${BOOKING_HORIZON_DAYS} days ahead.`,
  });
  const used = weeklyHours(userBookings, resource.id, start, excludeId);
  checks.push({
    key: "fair-share",
    label: "Fair-share weekly cap",
    pass: used + hours <= resource.weeklyHourCap,
    detail: `You hold ${used.toFixed(1)} h on this resource within 7 days of this slot; cap is ${resource.weeklyHourCap} h so others get a turn.`,
  });
  const open = userBookings.filter((b) => OPEN.includes(b.status) && b.end > now && b.id !== excludeId).length;
  checks.push({
    key: "open-requests",
    label: "Open request limit",
    pass: open < MAX_OPEN_REQUESTS,
    detail: `${open} of ${MAX_OPEN_REQUESTS} upcoming requests in use across all resources.`,
    fixHint: open >= MAX_OPEN_REQUESTS ? "Cancel a request you no longer need." : undefined,
  });
  return checks;
}

export function evaluate(checks: Check[], resource: Resource): Eligibility {
  return { eligible: checks.every((c) => c.pass), checks, needsSupervision: resource.supervisionRequired };
}

export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}

export type PriorityFactor = { label: string; points: number };

/**
 * Transparent priority score used to order competing requests for the same slot.
 * Shown in full to both reviewers and requesters. Higher = earlier in line.
 */
export function priorityScore(
  booking: Pick<Booking, "purposeType" | "createdAt" | "resourceId">,
  user: Pick<User, "strikes">,
  history: Booking[], // the requester's past bookings
  now = Date.now(),
): { score: number; factors: PriorityFactor[] } {
  const factors: PriorityFactor[] = [{ label: "Base", points: 50 }];
  const purposePts = { coursework: 20, research: 15, project: 10, personal: 0 }[booking.purposeType];
  factors.push({ label: `Purpose: ${booking.purposeType}`, points: purposePts });

  const recent = history.filter(
    (b) => b.resourceId === booking.resourceId && ["checked_out", "returned", "closed"].includes(b.status) && b.start > now - 30 * DAY,
  );
  const recentHours = recent.reduce((h, b) => h + (b.end - b.start) / HOUR, 0);
  if (recent.length === 0) factors.push({ label: "First use in 30 days", points: 10 });
  else factors.push({ label: `Recent use: ${recentHours.toFixed(1)} h in 30 days`, points: -Math.min(30, Math.round(recentHours * 2)) });

  const noShows = history.filter((b) => b.status === "closed" && b.decisionReason?.startsWith("No-show")).length;
  if (noShows) factors.push({ label: `No-shows: ${noShows}`, points: -5 * noShows });
  if (user.strikes) factors.push({ label: `Strikes: ${user.strikes}`, points: -10 * user.strikes });

  return { score: factors.reduce((s, f) => s + f.points, 0), factors };
}

export function eligibilitySummary(e: Eligibility) {
  const failed = e.checks.filter((c) => !c.pass);
  return failed.length ? failed.map((c) => `${c.label}: ${c.detail}`).join(" ") : "All requirements met.";
}
