import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "@/db";
import type { Role, User, Resource } from "@/db/schema";

const COOKIE = "ll_session";
const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? "loomlend-dev-secret-change-me-in-production");

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub) return null;
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, payload.sub) });
    return user ?? null;
  } catch {
    return null;
  }
});

export async function requireUser(roles?: Role[]): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect("/?denied=1");
  return user;
}

export function isStaff(user: Pick<User, "role">) {
  return user.role === "owner" || user.role === "manager" || user.role === "admin";
}

/** Owners control their own listings, managers their department's, admins everything. */
export function canManageResource(user: User, resource: Pick<Resource, "ownerId" | "department">) {
  if (user.role === "admin") return true;
  if (user.role === "manager") return resource.department === user.department;
  return resource.ownerId === user.id;
}

export function canReviewCerts(user: User) {
  return user.role === "manager" || user.role === "admin";
}
