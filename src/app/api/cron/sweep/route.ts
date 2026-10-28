import { sweep } from "@/lib/workflow";

// Called by Vercel Cron so reminders and overdue alerts go out even when nobody is browsing.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  await sweep(true);
  return Response.json({ ok: true, at: new Date().toISOString() });
}
