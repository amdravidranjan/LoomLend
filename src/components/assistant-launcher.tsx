"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ds/icons";

/** Compact "Ask LoomLend" entry point for the header. Opens the booking concierge (also reachable with g then a). */
export function AssistantLauncher({ className = "" }: { className?: string }) {
  const active = usePathname()?.startsWith("/assistant");
  return (
    <Link
      href="/assistant"
      aria-current={active ? "page" : undefined}
      title="Ask LoomLend: describe what you need and get bookable options"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-thread ${
        active ? "border-transparent bg-thread-soft text-thread" : "border-line bg-card text-ink hover:border-thread hover:text-thread"
      } ${className}`}
    >
      <Icon name="sparkle" size={16} />
      <span className="hidden sm:inline">Ask LoomLend</span>
      <span className="sm:hidden">Ask</span>
    </Link>
  );
}
