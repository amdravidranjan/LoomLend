import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="h-display text-5xl">🧶</p>
      <h1 className="h-display mt-4 text-2xl font-semibold">This thread doesn&apos;t lead anywhere</h1>
      <p className="mt-2 text-muted">The page doesn&apos;t exist, or it belongs to someone else&apos;s booking.</p>
      <Link href="/" className="btn-primary mt-6">Back home</Link>
    </div>
  );
}
