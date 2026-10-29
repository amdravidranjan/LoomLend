import Link from "next/link";
import { aiKeySource } from "@/lib/ai-key";
import { Icon } from "@/components/ds/icons";

/** Tells visitors whether AI features run on Claude or on fallbacks, and how to bring their own key. */
export async function AiKeyBanner({ compact = false }: { compact?: boolean }) {
  const source = await aiKeySource();
  if (source === "server") return null; // the deployment has its own key; nothing to ask for

  if (source === "visitor") {
    return (
      <p className={`flex flex-wrap items-center gap-2 rounded-lg border border-teal-200 bg-teal-soft px-3 py-2 text-sm text-teal ${compact ? "" : "mb-4"}`}>
        <Icon name="check" size={15} />
        AI features are using your Claude API key for this session.
        <Link href="/ai-key" className="font-medium underline underline-offset-2">Manage</Link>
      </p>
    );
  }

  return (
    <div className={`flex flex-wrap items-start gap-3 rounded-lg border border-indigo-200 bg-thread-soft/50 px-4 py-3 text-sm ${compact ? "" : "mb-4"}`}>
      <Icon name="sparkle" size={16} className="mt-0.5 text-thread" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Judges: have a Claude API key?</span> Paste it to try the AI booking assistant, photo comparison and reviewer notes
        on Claude. Otherwise everything still works: built-in rule-based fallbacks take over and are clearly labelled.
      </p>
      <Link href="/ai-key" className="btn-primary btn-sm">
        Add your key
      </Link>
    </div>
  );
}
