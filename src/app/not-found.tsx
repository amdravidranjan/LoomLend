import type { Metadata } from "next";
import Link from "next/link";
import { ThreadIllustration } from "@/components/ds/primitives";
import { Icon } from "@/components/ds/icons";

export const metadata: Metadata = { title: "Not found · LoomLend" };

export default function NotFound() {
  return (
    <div className="enter mx-auto flex max-w-md flex-col items-center py-14 text-center">
      <ThreadIllustration kind="needle" size={120} />
      <p className="mt-6 font-mono text-xs tracking-widest text-subtle">404</p>
      <h1 className="h-display mt-1 text-3xl font-semibold tracking-tight">This thread doesn&apos;t lead anywhere</h1>
      <p className="mt-2 text-muted">The page doesn&apos;t exist, or it belongs to someone else&apos;s booking. Bookings are only visible to the borrower and the staff who manage them.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/" className="btn-primary">
          <Icon name="home" size={16} />
          Back home
        </Link>
        <Link href="/resources" className="btn-ghost">
          Discover resources
        </Link>
      </div>
    </div>
  );
}
