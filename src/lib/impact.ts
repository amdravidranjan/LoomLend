import "server-only";
import { and, gte, inArray, lt, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { User } from "@/db/schema";
import { DAY } from "./time";
import { computeImpact, type ImpactReport } from "./impact-math";

export * from "./impact-math";

export const RANGES = [7, 30, 60] as const;
export type RangeDays = (typeof RANGES)[number];

export type ImpactScope = { department: string | null; label: string; canPickDepartment: boolean };

/** Admins see the whole campus (optionally one department); managers and owners see their own department. */
export function impactScope(user: User, requestedDept?: string | null): ImpactScope | null {
  if (user.role === "admin") {
    const d = requestedDept && requestedDept !== "all" ? requestedDept : null;
    return { department: d, label: d ? `${d} department` : "Whole campus", canPickDepartment: true };
  }
  if (user.role === "manager" || user.role === "owner") return { department: user.department, label: `${user.department} department`, canPickDepartment: false };
  return null;
}

export function parseRange(v: unknown): RangeDays {
  const n = Number(v);
  return (RANGES as readonly number[]).includes(n) ? (n as RangeDays) : 30;
}

export async function loadImpact(scope: ImpactScope, days: RangeDays, now: number): Promise<ImpactReport & { departments: string[] }> {
  const all = await db.select().from(schema.resources).where(ne(schema.resources.status, "retired"));
  const departments = [...new Set(all.map((r) => r.department))].sort();
  const resources = scope.department ? all.filter((r) => r.department === scope.department) : all;
  const ids = resources.map((r) => r.id);
  const from = now - days * DAY;
  const earliest = from - days * DAY; // previous period, for comparison
  const bookings = ids.length
    ? await db
        .select({
          id: schema.bookings.id,
          resourceId: schema.bookings.resourceId,
          userId: schema.bookings.userId,
          start: schema.bookings.start,
          end: schema.bookings.end,
          status: schema.bookings.status,
          decisionReason: schema.bookings.decisionReason,
          returnAt: schema.bookings.returnAt,
        })
        .from(schema.bookings)
        .where(and(inArray(schema.bookings.resourceId, ids), gte(schema.bookings.end, earliest), lt(schema.bookings.start, now)))
    : [];
  const incidents = ids.length
    ? await db
        .select({ id: schema.incidents.id, resourceId: schema.incidents.resourceId, createdAt: schema.incidents.createdAt })
        .from(schema.incidents)
        .where(and(inArray(schema.incidents.resourceId, ids), gte(schema.incidents.createdAt, earliest)))
    : [];
  // Only department is used (for cross-department sharing). No names leave this function.
  const users = await db.select({ id: schema.users.id, department: schema.users.department }).from(schema.users);
  return { ...computeImpact({ resources, bookings, incidents, users, from, to: now }), departments };
}
