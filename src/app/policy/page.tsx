import { BOOKING_HORIZON_DAYS, MAX_OPEN_REQUESTS, STRIKE_LIMIT } from "@/lib/catalog";
import { PageHeader, Section } from "@/components/ui";

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
        </ul>
      </Section>

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
