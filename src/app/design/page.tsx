import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LogoLockup, LogoMark, MARK } from "@/components/logo";
import { Advisory, Badge, Checks, Empty, Notice, Pill, Priority, Section, TextLink } from "@/components/ui";
import { ConditionSelect, PasswordField } from "@/components/forms";
import { ICON_NAMES, Icon } from "@/components/ds/icons";
import { Avatar, EmptyState, Kbd, LinkTabs, Meter, Skeleton, SkeletonCard, Stat, Stepper, ThreadIllustration, Tooltip, type Illustration } from "@/components/ds/primitives";
import { CopyButton, RelativeTime, Tabs, ThemeToggle } from "@/components/ds/client";
import { HOUR, currentTime } from "@/lib/time";
import { CelebrateDemo, ConfirmDemo, MotionDemo, OverlayDemos, ToastDemos } from "./demos";

export const metadata: Metadata = {
  title: "Design system · LoomLend",
  description: "LoomLend's brand, tokens, motion and components: the living style guide.",
};

const COLORS: { group: string; tokens: [string, string][] }[] = [
  { group: "Surface", tokens: [["--paper", "Page background"], ["--card", "Raised surface"], ["--sunken", "Wells & tracks"], ["--raised", "Popovers, dialogs"], ["--field", "Form fields"]] },
  { group: "Ink & lines", tokens: [["--ink", "Primary text"], ["--muted", "Secondary text (AA)"], ["--subtle", "Decorative only"], ["--line", "Hairlines"], ["--line-strong", "Hover borders"]] },
  { group: "Brand threads", tokens: [["--thread", "Indigo warp · accent, links"], ["--thread-solid", "Fill behind white text"], ["--thread-soft", "Accent wash"], ["--saffron", "Weft · highlights, unread"], ["--saffron-soft", "Highlight wash"]] },
  { group: "Status", tokens: [["--teal", "Success"], ["--amber", "Warning"], ["--rose", "Danger"], ["--sky", "Info"], ["--teal-soft", "Success wash"], ["--amber-soft", "Warning wash"], ["--rose-soft", "Danger wash"], ["--sky-soft", "Info wash"]] },
];

const TYPE: [string, string, string][] = [
  ["Display XL", "h-display text-5xl font-semibold tracking-tight", "Fraunces 48/1.05 · hero"],
  ["Display L", "h-display text-4xl font-semibold tracking-tight", "Fraunces 36 · page titles"],
  ["Display M", "h-display text-2xl font-semibold", "Fraunces 24 · section heroes"],
  ["Title", "text-base font-semibold", "Geist 16/600 · card titles"],
  ["Body", "text-sm", "Geist 14 · default UI text"],
  ["Small", "text-xs text-muted", "Geist 12 · meta, hints"],
  ["Kicker", "text-xs font-semibold tracking-[0.14em] text-saffron uppercase", "Geist 12/600 caps · context above titles"],
  ["Mono", "font-mono text-sm", "Geist Mono · refs, hashes"],
];

const MOTION: [string, string, string, string][] = [
  ["--dur-instant", "90ms", "var(--ease-out)", "Press feedback"],
  ["--dur-fast", "150ms", "var(--ease-out)", "Hover, exits"],
  ["--dur-base", "220ms", "var(--ease-out)", "Popovers, toasts"],
  ["--dur-slow", "360ms", "var(--ease-out)", "Page & list entry"],
  ["--ease-spring", "360ms", "var(--ease-spring)", "Status settle, badges"],
  ["--dur-story", "900ms", "var(--ease-in-out)", "Celebration, logo draw"],
];

function Block({ id, title, kicker, children, intro }: { id: string; title: string; kicker: string; children: ReactNode; intro?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24">
      <p className="text-xs font-semibold tracking-[0.14em] text-saffron uppercase">{kicker}</p>
      <h2 id={`${id}-h`} className="h-display mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      {intro && <p className="mt-2 max-w-2xl text-muted">{intro}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Specimen({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`card p-5 ${className}`}>
      <p className="label">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export default function DesignPage() {
  const now = currentTime();
  const toc = [
    ["brand", "Brand"],
    ["color", "Colour"],
    ["type", "Type"],
    ["space", "Space, radius, elevation"],
    ["motion", "Motion"],
    ["icons", "Icons"],
    ["components", "Components"],
    ["feedback", "Feedback"],
    ["states", "Empty & loading"],
    ["principles", "Principles"],
  ];
  return (
    <div className="lg:grid lg:grid-cols-[11rem_1fr] lg:gap-10">
      <nav aria-label="Style guide sections" className="no-print sticky top-[calc(var(--header-h)+1.5rem)] hidden self-start lg:block">
        <p className="label">On this page</p>
        <ul className="space-y-1 text-sm">
          {toc.map(([id, l]) => (
            <li key={id}>
              <a href={`#${id}`} className="block rounded-md px-2 py-1 text-muted hover:bg-sunken hover:text-ink">{l}</a>
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <p className="label">Theme</p>
          <ThemeToggle />
        </div>
      </nav>

      <div className="min-w-0 space-y-16">
        <header className="enter">
          <p className="text-xs font-semibold tracking-[0.14em] text-saffron uppercase">Design system · v1</p>
          <h1 className="h-display mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">Loom, the LoomLend design system</h1>
          <p className="mt-3 max-w-2xl text-lg text-muted">
            Warm paper, dark ink, an indigo warp and a saffron weft. Every token here is live: switch the theme and the whole page re-weaves. Components are the same ones the
            product uses.
          </p>
          <div className="mt-4 lg:hidden"><ThemeToggle /></div>
        </header>

        <Block id="brand" kicker="01" title="Brand" intro={<>The mark is one thread bent into an <strong className="text-ink">L</strong>. It drops as an indigo warp, turns a soft corner and leaves as a saffron weft, passing <em>over</em> a second warp on the way: one stitch of plain weave. Every borrow, a thread on the loom.</>}>
          <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
            <div className="card weave flex flex-col items-center justify-center gap-6 p-10">
              <LogoMark size={128} animated />
              <LogoLockup size={40} />
            </div>
            <div className="grid gap-4">
              <Specimen label="Sizes: legible down to a 16 px favicon">
                <div className="flex items-end gap-5">
                  {[16, 20, 28, 40, 64].map((s) => (
                    <div key={s} className="flex flex-col items-center gap-1.5">
                      <LogoMark size={s} />
                      <span className="text-[11px] text-muted tabular">{s}</span>
                    </div>
                  ))}
                </div>
              </Specimen>
              <Specimen label="Mark colours (fixed, theme-independent)">
                <div className="flex flex-wrap gap-3">
                  {Object.entries(MARK)
                    .filter(([, v]) => v.startsWith("#"))
                    .map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2 text-xs">
                        <span className="size-7 rounded-md ring-1 ring-line" style={{ background: v }} />
                        <span>
                          <span className="block font-medium">{k}</span>
                          <span className="block font-mono text-muted">{v}</span>
                        </span>
                      </div>
                    ))}
                </div>
              </Specimen>
              <Specimen label="Rules">
                <ul className="space-y-1.5 text-sm text-ink/85">
                  <li>Clear space: half the mark&apos;s width on every side.</li>
                  <li>Never recolour the threads or put the mark on saffron.</li>
                  <li>The wordmark is Fraunces semibold; “Lend” takes the thread colour.</li>
                  <li>The name nods to looms, ink and craft; it borrows no one&apos;s branding.</li>
                </ul>
              </Specimen>
            </div>
          </div>
        </Block>

        <Block id="color" kicker="02" title="Colour" intro="Semantic roles, not raw palette values. Light mode is warm paper; dark mode is the night loom, where accent colours shift lighter for text and solid fills keep a deeper step so white labels stay AA.">
          <div className="space-y-6">
            {COLORS.map((g) => (
              <div key={g.group}>
                <p className="label">{g.group}</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {g.tokens.map(([t, d]) => (
                    <div key={t} className="overflow-hidden rounded-xl border border-line bg-card">
                      <div className="h-16 border-b border-line" style={{ background: `var(${t})` }} />
                      <div className="p-2.5">
                        <p className="font-mono text-xs">{t}</p>
                        <p className="text-xs text-muted">{d}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <Specimen label="Contrast pairs (WCAG)">
              <div className="flex flex-wrap gap-2 text-sm">
                {[
                  ["text-ink bg-paper", "Ink on paper · 15:1"],
                  ["text-muted bg-paper", "Muted on paper · 5.6:1"],
                  ["text-white bg-thread", "White on thread · 7:1"],
                  ["text-teal bg-teal-soft", "Teal on wash · 4.7:1"],
                  ["text-rose bg-rose-soft", "Rose on wash · 5.2:1"],
                  ["text-amber-ink bg-amber-soft", "Amber on wash · 7:1"],
                ].map(([c, l]) => (
                  <span key={l} className={`rounded-lg border border-line px-3 py-2 ${c}`}>{l}</span>
                ))}
              </div>
            </Specimen>
          </div>
        </Block>

        <Block id="type" kicker="03" title="Typography" intro="Fraunces (display) brings the warmth of a printed notice board; Geist (UI) keeps forms crisp. Numbers that change over time use tabular figures so they don't jitter.">
          <div className="card divide-y divide-line">
            {TYPE.map(([n, c, d]) => (
              <div key={n} className="grid gap-2 p-4 sm:grid-cols-[10rem_1fr] sm:items-baseline">
                <div>
                  <p className="text-sm font-medium">{n}</p>
                  <p className="text-xs text-muted">{d}</p>
                </div>
                <p className={`truncate ${c}`}>Every borrow, a thread</p>
              </div>
            ))}
            <div className="grid gap-2 p-4 sm:grid-cols-[10rem_1fr] sm:items-baseline">
              <p className="text-sm font-medium">Tabular</p>
              <p className="text-2xl tabular">10:05 – 12:40 · ₹2,000 · 1/3</p>
            </div>
          </div>
        </Block>

        <Block id="space" kicker="04" title="Space, radius, elevation">
          <div className="grid gap-4 lg:grid-cols-3">
            <Specimen label="Spacing (4 px base)">
              <div className="space-y-1.5">
                {[1, 2, 3, 4, 6, 8, 12].map((s) => (
                  <div key={s} className="flex items-center gap-3 text-xs">
                    <span className="w-8 font-mono text-muted">{s * 4}</span>
                    <span className="h-2.5 rounded-sm bg-thread/70" style={{ width: s * 8 }} />
                  </div>
                ))}
              </div>
            </Specimen>
            <Specimen label="Radii">
              <div className="flex flex-wrap gap-3">
                {[["md", "rounded-md"], ["lg", "rounded-lg"], ["xl", "rounded-xl"], ["2xl", "rounded-2xl"], ["full", "rounded-full"]].map(([l, c]) => (
                  <div key={l} className="flex flex-col items-center gap-1">
                    <span className={`size-12 border-2 border-thread bg-thread-soft ${c}`} />
                    <span className="text-xs text-muted">{l}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">Inputs & buttons lg · cards xl · dialogs 2xl · status pills full.</p>
            </Specimen>
            <Specimen label="Elevation">
              <div className="flex gap-4">
                {[1, 2, 3].map((e) => (
                  <div key={e} className="grid size-16 place-items-center rounded-xl border border-line bg-raised text-xs text-muted" style={{ boxShadow: `var(--shadow-${e})` }}>
                    {e}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">1 cards · 2 hover lift · 3 menus, toasts, dialogs. Focus ring: 2 px thread outline, 2 px offset.</p>
            </Specimen>
          </div>
        </Block>

        <Block id="motion" kicker="05" title="Motion" intro="Motion explains change: things enter by rising, leave quickly, and settle with a little spring when their status changes. Click a track to play it. Everything collapses to instant under prefers-reduced-motion.">
          <div className="grid gap-3 md:grid-cols-2">
            {MOTION.map(([n, ms, ease, use]) => (
              <div key={n}>
                <MotionDemo name={n} ms={ms} ease={ease} />
                <p className="mt-1 px-1 text-xs text-muted">{use}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Specimen label="Status change (animate)">
              <div className="flex flex-wrap gap-2">
                <Badge status="pending" animate />
                <Badge status="approved" animate />
                <Badge status="checked_out" animate />
              </div>
            </Specimen>
            <Specimen label="Peak moment">
              <CelebrateDemo />
              <p className="mt-2 text-xs text-muted">Plays automatically on approvals, confirmed returns and check-ins.</p>
            </Specimen>
            <Specimen label="Route transitions">
              <p className="text-sm text-ink/85">Pages cross-fade and rise via React &lt;ViewTransition&gt;; the header and tab bar stay anchored. A thin thread across the top shows navigations slower than 120 ms.</p>
            </Specimen>
          </div>
        </Block>

        <Block id="icons" kicker="06" title="Icons" intro="One hand-drawn set on a 24 px grid with a 1.75 stroke, matched to Geist. Icons are decorative by default; pass a title when an icon carries meaning alone.">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-10">
            {ICON_NAMES.map((n) => (
              <Tooltip key={n} label={n} className="w-full">
                <span className="flex w-full flex-col items-center gap-1 rounded-lg border border-line bg-card py-3 text-ink/80">
                  <Icon name={n} size={20} />
                  <span className="w-full truncate px-1 text-center text-[10px] text-muted">{n}</span>
                </span>
              </Tooltip>
            ))}
          </div>
        </Block>

        <Block id="components" kicker="07" title="Components">
          <div className="grid gap-4 lg:grid-cols-2">
            <Specimen label="Buttons">
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary">Primary</button>
                <button className="btn-ghost">Ghost</button>
                <button className="btn-subtle">Subtle</button>
                <button className="btn-ok">Confirm</button>
                <button className="btn-danger">Danger</button>
                <button className="btn-primary" disabled>Disabled</button>
                <button className="btn-primary" aria-busy>
                  <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
                  Working…
                </button>
                <button className="btn-ghost btn-sm">Small</button>
                <button className="btn-icon btn-ghost" aria-label="Search"><Icon name="search" size={18} /></button>
              </div>
              <p className="mt-3 text-xs text-muted">Press scales to 97%. Touch targets grow to 44 px on coarse pointers. <code className="font-mono">&lt;Submit confirm&gt;</code> asks before destructive actions; btn-danger confirms by default.</p>
            </Specimen>
            <Specimen label="Status badges (every lifecycle state)">
              <div className="flex flex-wrap gap-2">
                {["pending", "approved", "waitlisted", "checked_out", "returned", "closed", "rejected", "cancelled", "overdue", "open", "resolved", "maintenance", "verified"].map((s) => (
                  <Badge key={s} status={s} />
                ))}
              </div>
            </Specimen>
            <Specimen label="Pills">
              <div className="flex flex-wrap gap-2">
                <Pill>Equipment</Pill>
                <Pill icon="clock">≤ 2 h</Pill>
                <Pill tone="ok" icon="check">Instant approval</Pill>
                <Pill tone="warn" icon="user">Supervised</Pill>
                <Pill tone="info" icon="hourglass">2 waiting</Pill>
                <Pill tone="danger">Concentrated</Pill>
              </div>
            </Specimen>
            <Specimen label="Avatar · Kbd · Tooltip · Copy · Relative time">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex -space-x-2">
                  {["Priya Natarajan", "Meena Sundar", "Dr. Arun Prakash", "Kavya Raman", "Vikram Shah"].map((n) => (
                    <Avatar key={n} name={n} ring />
                  ))}
                </div>
                <span className="flex gap-1"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
                <Tooltip label="Exact time shows on hover and focus"><button className="btn-ghost btn-sm">Hover me</button></Tooltip>
                <CopyButton value="LL-8F2A1C" showValue />
                <span className="text-sm">Starts <RelativeTime ms={now + 2 * HOUR + 14 * 60000} now={now} style="countdown" /></span>
              </div>
            </Specimen>
            <Specimen label="Stepper">
              <Stepper current={2} steps={[{ label: "Request" }, { label: "Approved" }, { label: "Check in" }, { label: "Return" }, { label: "Closed" }]} />
            </Specimen>
            <Specimen label="Tabs (client, arrow keys) · LinkTabs (URL-driven)">
              <Tabs tabs={[{ label: "Upcoming", count: 2, content: <p className="text-sm text-muted">Two bookings this week.</p> }, { label: "History", count: 9, content: <p className="text-sm text-muted">Nine completed loans.</p> }]} />
              <LinkTabs className="mt-4" label="Example" items={[{ href: "/design#components", label: "All", count: 12, active: true }, { href: "/design#components", label: "Unread", count: 3 }]} />
            </Specimen>
            <Specimen label="Stat · Meter">
              <div className="grid grid-cols-3 gap-4">
                <Stat value="142" label="Hours shared" />
                <Stat value="96%" label="On time" tone="teal" />
                <Stat value="2/3" label="Strikes" tone="rose" />
              </div>
              <Meter value={5} max={7} tone="teal" label="Training" className="mt-4" />
            </Specimen>
            <Specimen label="Form controls">
              <div className="space-y-3">
                <div>
                  <label className="label" htmlFor="ds-in">Text field</label>
                  <input id="ds-in" className="input" placeholder="Describe your need…" />
                </div>
                <PasswordField id="ds-pw" name="ds-pw" autoComplete="off" hint="With a show / hide toggle." />
                <ConditionSelect name="ds-cond" />
              </div>
            </Specimen>
            <Specimen label="Eligibility checks" className="lg:col-span-1">
              <Checks
                summary
                checks={[
                  { key: "id", label: "Identity verified", pass: true, detail: "Campus ID checked by Facilities." },
                  { key: "t", label: "Training: Laser Cutter Operator", pass: false, detail: "Submitted, awaiting a manager.", fixHint: "Ask Dr. Arun Prakash to verify your session record." },
                  { key: "cap", label: "Fair-share cap", pass: true, detail: "2 of 4 hours used this week." },
                ]}
              />
            </Specimen>
            <Specimen label="Priority · Advisory">
              <Priority score={64} factors={[{ label: "Coursework deadline", points: 30 }, { label: "First booking this week", points: 20 }, { label: "Good return record", points: 20 }, { label: "One strike", points: -6 }]} />
              <div className="mt-4">
                <Advisory note={{ source: "rules", risk: "medium", summary: "Second laser booking this week; previous return was 20 min late.", flags: ["Supervised resource: staff must co-sign check-in"] }} />
              </div>
            </Specimen>
          </div>
        </Block>

        <Block id="feedback" kicker="08" title="Feedback" intro="Every action answers: inline (focus moves to the message), as a toast, and for peak moments with a small woven burst.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Specimen label="Notices">
              <div className="space-y-2">
                <Notice>Demo mode lets you check in at any time on the booking day.</Notice>
                <Notice tone="ok" title="Approved">The requester has been notified.</Notice>
                <Notice tone="warn">Your identity is not verified yet.</Notice>
                <Notice tone="error">That slot overlaps an approved booking.</Notice>
              </div>
            </Specimen>
            <div className="space-y-4">
              <Specimen label="Toasts"><ToastDemos /></Specimen>
              <Specimen label="Confirm dialog"><ConfirmDemo /></Specimen>
              <Specimen label="Overlays"><OverlayDemos /></Specimen>
            </div>
          </div>
        </Block>

        <Block id="states" kicker="09" title="Empty & loading states" intro="No dead ends: every empty state says why it's empty and offers the next step. Skeletons match the real layout so nothing shifts when content arrives.">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {(["spool", "loom", "inbox", "needle", "knot", "check"] as Illustration[]).map((k) => (
              <div key={k} className="card flex flex-col items-center gap-2 p-3">
                <ThreadIllustration kind={k} size={72} />
                <span className="font-mono text-xs text-muted">{k}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <EmptyState title="No bookings yet" illustration="spool" description="Requests you make appear here with a countdown." action={<TextLink href="/resources" arrow>Discover resources</TextLink>} />
            <div className="space-y-3">
              <SkeletonCard />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
            <Section title="Section with Empty">
              <Empty>Nothing waiting.</Empty>
            </Section>
          </div>
        </Block>

        <Block id="principles" kicker="10" title="Principles">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[
              ["Show the rule, then the decision", "Eligibility, priority and fairness are always explained before anyone has to ask."],
              ["A person decides", "AI notes are labelled advisory and visually secondary to human actions."],
              ["One obvious next step", "Each page leads with a single primary action; everything else is ghost or subtle (Hick, Von Restorff)."],
              ["Built for the lab door", "Scan sits in the thumb zone; targets are 44 px; forms remember what they can (Fitts, Postel)."],
              ["Calm until it matters", "Motion is short and quiet, with one small celebration at the end of a journey (peak-end)."],
              ["Nothing shifts", "Skeletons match layouts, numbers are tabular, and times update in place."],
            ].map(([t, d]) => (
              <div key={t} className="card p-5">
                <p className="font-semibold">{t}</p>
                <p className="mt-1 text-sm text-muted">{d}</p>
              </div>
            ))}
          </div>
        </Block>
      </div>
    </div>
  );
}
