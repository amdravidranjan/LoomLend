import "server-only";
import { db, schema } from "@/db";

export async function notify(userId: string, kind: string, title: string, body: string, link?: string) {
  await db.insert(schema.notifications).values({
    id: crypto.randomUUID(),
    userId,
    kind,
    title,
    body,
    link: link ?? null,
    read: false,
    createdAt: Date.now(),
  });
}
