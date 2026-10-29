import Link from "next/link";
import { BOOKING_HORIZON_DAYS, MAX_OPEN_REQUESTS, STRIKE_LIMIT } from "@/lib/catalog";
import { CREDIT_POINTS, KEY_FORMULA, MAX_CREDITS, WEIGHT_FORMULA } from "@/lib/lottery";
import { PageHeader, Section } from "@/components/ui";

export const metadata = { title: "Fair-use policy · LoomLend" };

export default function PolicyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader kicker="Transparency" title="How LoomLend shares fairly" />
      <p className="text-ink/80">
        Shared equipment only works if people trust the rules. These are the exact rules the system applies. Every decision a person makes is
        recorded with a reason, and every automatic rule is explained where it applies.
      </p>

      <Section title="1 · Before you can request">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Your campus identity is verified by the facilities office (some open rooms skip this).</li>
          <li>Your membership type is one the owner allows (students, researchers, staff, external partners).</li>
          <li>Every training the resource needs is on your profile <strong>and verified by a manager</strong>.</li>
          <li>The slot is inside opening hours and within the owner&apos;s per-booking limit.</li>
          <li>You can book up to {BOOKING_HORIZON_DAYS} days ahead.</li>
        </ul>
        <p className="mt-2 text-sm text-muted">You see this checklist, with what to fix, before you ask. Nothing is hidden.</p>
      </Section>

      <Section title="2 · Limits that stop monopolies">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li><strong>Fair-share cap:</strong> each resource sets the most hours one person can hold within any 7-day window.</li>
          <li><strong>Open request limit:</strong> at most {MAX_OPEN_REQUESTS} upcoming requests per person across all resources.</li>
          <li><strong>No-shows</strong> are recorded and lower your priority on busy resources.</li>
          <li>Managers see a <strong>fair-use watch</strong> that flags when one person holds most of a resource&apos;s recent hours.</li>
        </ul>
      </Section>

      <Section title="3 · When several people want the same slot">
        <p className="text-sm">Each request gets a priority score, shown in full to the requester and the reviewer:</p>
        <table className="mt-2 w-full text-sm">
          <tbody className="divide-y divide-line">
            {[
              ["Base", "+50"],
              ["Coursework / Research / Project / Personal", "+20 / +15 / +10 / 0"],
              ["First use of this resource in 30 days", "+10"],
              ["Recent use of this resource", "−2 per hour used in 30 days (max −30)"],
              ["Each recorded no-show", "−5"],
              ["Each active strike", "−10"],
              [`Each fairness credit on this resource (max ${MAX_CREDITS})`, `+${CREDIT_POINTS}`],
            ].map(([k, v]) => (
              <tr key={k}><td className="py-1.5 pr-4">{k}</td><td className="font-mono">{v}</td></tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          <li>If a slot is already approved for someone else, new requests go on a <strong>waiting list</strong> ordered by priority, then by who asked first.</li>
          <li>When a reviewer approves one request, overlapping ones move to the waiting list automatically, <strong>with a reason</strong>.</li>
          <li>If an approved booking is cancelled, the best-placed waiting request goes back to the owner for review.</li>
          <li>The score guides the reviewer; the owner makes the decision and must give a reason to reject or waitlist.</li>
          <li>On resources that use fair-draw rounds, the score sets your chance in the draw instead (next section).</li>
        </ul>
      </Section>

      <div id="rounds" className="scroll-mt-20">
        <Section title="3b · Fair-draw rounds for busy resources">
          <p className="text-sm">
            When a resource regularly has more people asking than hours available (for example the laser cutter), first-come-first-served rewards whoever
            refreshes fastest. Owners can switch such resources to <strong>fair-draw rounds</strong>:
          </p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm">
            <li>
              <strong>Pooling.</strong> Requests for a day join that day&apos;s draw until the owner&apos;s lead time before it (usually 24 h). Asking early gives no
              advantage. Requests after the close are reviewed normally.
            </li>
            <li>
              <strong>Commit.</strong> When the first request arrives, LoomLend generates a secret 32-byte random seed and immediately publishes its SHA-256
              fingerprint (the <em>commitment</em>). Anyone can see it on the resource page and the draw page.
            </li>
            <li>
              <strong>Draw.</strong> At closing time the seed is revealed. Each entry gets a random number <code className="font-mono text-xs">u</code> from{" "}
              <code className="font-mono text-xs">HMAC-SHA256(seed, booking id)</code>, a weight <code className="font-mono text-xs">{WEIGHT_FORMULA}</code> and a key{" "}
              <code className="font-mono text-xs">{KEY_FORMULA}</code> (the Efraimidis–Spirakis weighted shuffle). Higher keys go first, so a request with twice
              the weight is twice as likely to be drawn first, and nobody&apos;s chance is ever zero.
            </li>
            <li>
              <strong>Allocate.</strong> In key order, each request gets its slot unless it overlaps a slot already given out in the draw, clashes with an approved
              booking, or would take that person past the resource&apos;s fair-share cap.
            </li>
            <li>
              <strong>Human oversight.</strong> Winners are confirmed by the owner in one click and re-checked against every requirement. The owner can override a
              winner only with a reason, which is published next to the draw; the next entry in the published order then moves up.
            </li>
            <li>
              <strong>Fairness credits.</strong> Everyone who misses out joins the waiting list in draw order and earns +1 credit on that resource (worth +
              {CREDIT_POINTS} priority, up to {MAX_CREDITS} credits). Credits are used up when you win, so repeated bad luck is corrected without ever
              becoming a guarantee.
            </li>
            <li>
              <strong>Verify.</strong> Every draw has a public page showing the commitment, the revealed seed, each entry&apos;s weight, random number, key and
              outcome (entrants are numbered, never named) and a <em>Verify in your browser</em> button that re-runs the exact same code. Because the
              commitment was published before anyone entered, the seed cannot have been chosen to favour anyone.
            </li>
          </ol>
          <p className="mt-2 text-sm text-muted">
            The <Link href="/fairness" className="text-thread underline">fairness ledger</Link> publishes how evenly hours are spread on every resource
            (Gini coefficient, Lorenz curve, top-10% share, first-try success, waiting times) and nudges owners when one resource becomes concentrated.
          </p>
        </Section>
      </div>

      <Section title="4 · Accountability">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Check-in and return both record condition, with optional photos. A drop in condition opens a damage report automatically.</li>
          <li>Late returns are flagged to both sides; extensions are granted only if nobody has the next slot.</li>
          <li>Incidents are decided by a department manager or administrator. Strikes are never automatic.</li>
          <li>{STRIKE_LIMIT} strikes suspend booking privileges until an administrator reviews the account.</li>
          <li>Every important action goes into a hash-chained activity history that both parties can read for their booking.</li>
        </ul>
      </Section>

      <Section title="5 · AI and your data">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>An AI assistant (Claude) may write a short note for reviewers summarising a request or incident. It never approves, rejects or penalises.</li>
          <li>The assistant receives your membership type, department, track record and stated purpose; <strong>never your name or email</strong>.</li>
          <li>Owners see your name, department, standing and purpose. Only administrators see email addresses.</li>
          <li>Other members only see that a slot is taken, not who took it.</li>
        </ul>
      </Section>
    </div>
  );
}
