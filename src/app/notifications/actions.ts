"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";

/** Toggle one notification's read state (only the owner's own notifications). */
export async function setReadAction(fd: FormData) {
  const user = await requireUser();
  const id = String(fd.get("id") ?? "");
  const read = fd.get("read") === "1";
  await db.update(schema.notifications).set({ read }).where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, user.id)));
  revalidatePath("/", "layout");
}
