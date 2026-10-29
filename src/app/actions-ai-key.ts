"use server";

import { revalidatePath } from "next/cache";
import { clearVisitorKey, looksLikeKey, storeVisitorKey, testKey } from "@/lib/ai-key";
import type { FormState } from "@/app/actions";

export async function saveAiKeyAction(_: FormState, fd: FormData): Promise<FormState> {
  const key = String(fd.get("apiKey") ?? "").trim();
  if (!looksLikeKey(key)) return { error: "That doesn't look like a Claude API key. Keys start with sk-ant-." };
  const check = await testKey(key);
  if (!check.ok) return { error: check.message };
  await storeVisitorKey(key);
  revalidatePath("/", "layout");
  return { ok: "Key saved for this browser session. AI features now use Claude." };
}

export async function removeAiKeyAction(): Promise<FormState> {
  await clearVisitorKey();
  revalidatePath("/", "layout");
  return { ok: "Key removed. AI features are back on the built-in fallbacks." };
}
