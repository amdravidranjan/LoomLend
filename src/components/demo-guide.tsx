"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { demoLoginAction } from "@/app/actions";
import { Icon } from "@/components/ds/icons";

// Guided judge tour. Each step says who you should be, where, and what to click. The guide
// highlights the control, advances by itself once the step is done, and nudges after a quiet spell.

type Target = { text: string | string[]; selector?: string };
type Ctx = { booking?: string; incident?: string };

type Step = {
  title: string;
  body: string;
  persona?: string; // demo user id this step is played as
  path?: (c: Ctx) => string | null; // where to be; null = an earlier step was skipped
  match?: RegExp; // looser location match than `path`
  targets?: Target[]; // highlighted, in order; the first found gets the "click here" tag
  doneWhen?: { path?: RegExp; text?: string | string[] }; // otherwise: the first target disappears after being seen
  needs?: keyof Ctx;
};

const PEOPLE: Record<string, string> = {
  "u-priya": "Priya (student)",
  "u-rahul": "Rahul (oscilloscope owner)",
  "u-kavya": "Kavya (facilities admin)",
  "u-meena": "Meena (laser cutter owner)",
};

const STEPS: Step[] = [
  {
    title: "Welcome, judges",
    body: "This 6-minute tour follows one oscilloscope booking from request to damage dispute, then runs a verifiable fair draw and ends on the impact dashboard. You play four people; the guide signs you in as each one and shows exactly where to click.",
  },
  {
    title: "Ask the booking assistant",
    body: "You are Priya, a 3rd-year ECE student. Click the oscilloscope suggestion (or type what you need and press Enter). Without a Claude key it answers in basic mode; add your own key at /ai-key to see Claude.",
    persona: "u-priya",
    path: () => "/assistant",
    targets: [{ text: "oscilloscope", selector: "main button" }, { text: "", selector: "#assistant-input" }],
    doneWhen: { text: ["Request this slot", "Join the waiting list", "Enter the draw"] },
  },
  {
    title: "Pick a slot",
    body: "Every option was checked against Priya's training and live availability. Click Request this slot on any card (a waiting-list option works too).",
    persona: "u-priya",
    path: () => "/assistant",
    targets: [{ text: ["Request this slot", "Join the waiting list", "Enter the draw"], selector: "main a" }],
    doneWhen: { path: /^\/resources\// },
  },
  {
    title: "Send the request",
    body: "The form is prefilled from the chat. Note the requirement checklist and the priority breakdown, then press Send request. (If the form is missing, pick a date and time under Check a slot and press Check first.)",
    persona: "u-priya",
    match: /^\/resources\/[^/]+$/,
    path: () => "/resources/r-scope",
    targets: [{ text: ["Send request", "Join the waiting list", "Book now", "Enter the draw"], selector: "main button" }, { text: "Check", selector: "main button" }],
    doneWhen: { path: /^\/bookings\/[^/]+$/ },
  },
  {
    title: "Approve as the owner",
    body: "Rahul owns the oscilloscope. He sees the requirement check, competing requests and the priority score. Optionally type a reason, then press Approve.",
    persona: "u-rahul",
    path: (c) => (c.booking ? `/bookings/${c.booking}` : null),
    needs: "booking",
    targets: [{ text: "Approve", selector: "main button" }],
  },
  {
    title: "Check in at the machine",
    body: "Back as Priya. On a phone she would scan the QR tag stuck on the oscilloscope. Judges have no tag, so the simulated scan is pre-selected. Keep the condition as Good and press Check in now.",
    persona: "u-priya",
    path: (c) => (c.booking ? `/bookings/${c.booking}` : null),
    needs: "booking",
    targets: [{ text: "Check in now", selector: "main button" }, { text: "Simulate scanning the tag", selector: "main label" }],
  },
  {
    title: "Return it slightly worse",
    body: "Pretend it came back with a scratch: choose Fair (minor wear), then press Return it. A drop in condition opens a damage report automatically.",
    persona: "u-priya",
    path: (c) => (c.booking ? `/bookings/${c.booking}` : null),
    needs: "booking",
    targets: [{ text: "Return it", selector: "main button" }, { text: "Fair", selector: "main label" }],
  },
  {
    title: "Owner confirms the return",
    body: "Rahul compares the check-in and return records, then presses Confirm & close. The damage report is already waiting for a manager; the AI never decides.",
    persona: "u-rahul",
    path: (c) => (c.booking ? `/bookings/${c.booking}` : null),
    needs: "booking",
    targets: [{ text: "Confirm & close", selector: "main button" }],
  },
  {
    title: "Open the dispute",
    body: "Kavya, the facilities admin, handles disputes. Open the incident listed on this booking.",
    persona: "u-kavya",
    path: (c) => (c.booking ? `/bookings/${c.booking}` : null),
    needs: "booking",
    targets: [{ text: "", selector: 'main a[href^="/incidents/"]' }],
    doneWhen: { path: /^\/incidents\/[^/]+$/ },
  },
  {
    title: "Decide, having read both sides",
    body: "Both accounts appear before any decision. Write a short resolution (10+ characters), tick I have read both sides, choose Upheld or Dismiss, and press Record decision. A strike is optional and only a person can issue it.",
    persona: "u-kavya",
    path: (c) => (c.incident ? `/incidents/${c.incident}` : null),
    needs: "incident",
    targets: [{ text: "Record decision", selector: "main button" }, { text: "I have read both sides", selector: "main label" }, { text: "", selector: "main #resolution" }],
  },
  {
    title: "Run a fair draw",
    body: "The laser cutter is in high demand, so each day's requests are drawn by weighted lottery. The seed's fingerprint was published before entries closed, so nobody can rig it. Press Run draw now (demo). If it already ran, go to the next step.",
    persona: "u-meena",
    path: () => "/resources/r-laser",
    targets: [{ text: "Run draw now", selector: "main button" }],
  },
  {
    title: "Confirm the winners",
    body: "Winners wait for the owner. Each one is re-checked against the requirements when Meena confirms; everyone else joins the waiting list and earns a fairness credit.",
    persona: "u-meena",
    path: () => "/resources/r-laser",
    targets: [{ text: "Confirm winners", selector: "main button" }],
  },
  {
    title: "Open the published draw",
    body: "Under Recent draws, open the newest draw.",
    persona: "u-meena",
    path: () => "/resources/r-laser",
    targets: [{ text: "", selector: 'main a[href^="/fairness/rounds/"]' }],
    doneWhen: { path: /^\/fairness\/rounds\// },
  },
  {
    title: "Verify it yourself",
    body: "Press Verify in your browser. It hashes the revealed seed, checks it matches the commitment published earlier, and recomputes every entry's random number, key and outcome. Nothing is sent to the server.",
    match: /^\/fairness\/rounds\//,
    targets: [{ text: ["Verify in your browser", "Verify again"], selector: "main button" }],
    doneWhen: { text: "Verified:" },
  },
  {
    title: "The case for the principal",
    body: "Kavya's impact dashboard: rupees saved versus renting, idle hours unlocked, a demand heatmap, cross-department sharing and second-unit payback. Scroll through, try the 7/30/60-day switch, then press Next.",
    persona: "u-kavya",
    path: () => "/impact",
    targets: [{ text: "Download CSV", selector: "main a, main button" }],
    doneWhen: {},
  },
  {
    title: "That's the core journey",
    body: "Explore freely: Ctrl/⌘ K searches everything, /fairness shows the fairness ledger, /admin shows the tamper-evident audit chain, and /design the style guide. Kavya → Admin → Reset demo data restores the starting state for the next judge.",
  },
];

const KEY = "ll-demo-guide";
const IDLE_MS = 15_000;

type Saved = Ctx & { step: number; open: boolean; seen?: boolean };

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode: the tour still works for this page view
  }
}

function visible(el: Element) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && !el.closest("[data-guide-ui]");
}

function find(t: Target): Element | null {
  const texts = (Array.isArray(t.text) ? t.text : [t.text]).map((s) => s.toLowerCase());
  for (const el of document.querySelectorAll(t.selector ?? "button, a, label")) {
    if (!visible(el)) continue;
    const content = (el.textContent ?? "").toLowerCase();
    if (texts.some((s) => content.includes(s))) return el;
  }
  return null;
}

function pageHas(text: string) {
  return (document.querySelector("main")?.textContent ?? "").includes(text);
}

export function DemoGuide({ userId }: { userId: string | null }) {
  const pathname = usePathname();
  const [state, setState] = useState<Saved>({ step: 0, open: false });
  const [ready, setReady] = useState(false);
  const [rects, setRects] = useState<DOMRect[]>([]);
  const [missing, setMissing] = useState(false);
  const [idle, setIdle] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const seenTarget = useRef(false);
  const lastActive = useRef(0);
  const missingSince = useRef<number | null>(null);

  // Restore after mount (localStorage isn't available during server render). First-time visitors get the welcome open.
  useEffect(() => {
    const s = load();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from storage
    setState(s ?? { step: 0, open: true });
    setReady(true);
  }, []);

  const update = useCallback((patch: Partial<Saved>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  const step = STEPS[Math.min(state.step, STEPS.length - 1)];
  const where = step.path?.(state) ?? null;
  const rightPerson = !step.persona || step.persona === userId;
  const rightPlace = step.match ? step.match.test(pathname) : where ? pathname === where : true;
  const blocked = step.needs !== undefined && !state[step.needs];
  const onSpot = state.open && rightPerson && rightPlace && !blocked;

  const go = useCallback(
    (to: number) => {
      seenTarget.current = false;
      missingSince.current = null;
      lastActive.current = Date.now();
      setIdle(false);
      setMissing(false);
      setExpanded(false);
      update({ step: Math.max(0, Math.min(STEPS.length - 1, to)) });
    },
    [update],
  );

  // Track activity for the idle nudge.
  useEffect(() => {
    lastActive.current = Date.now();
    const poke = () => {
      lastActive.current = Date.now();
      setIdle(false);
    };
    const opts = { passive: true } as const;
    window.addEventListener("pointerdown", poke, opts);
    window.addEventListener("keydown", poke, opts);
    window.addEventListener("wheel", poke, opts);
    window.addEventListener("touchmove", poke, opts);
    return () => {
      window.removeEventListener("pointerdown", poke);
      window.removeEventListener("keydown", poke);
      window.removeEventListener("wheel", poke);
      window.removeEventListener("touchmove", poke);
    };
  }, []);

  // Poll the page: position highlights, detect completion, detect idleness.
  useEffect(() => {
    if (!ready || !state.open) return;
    const tick = () => {
      // Remember the booking and incident the judge creates, so later steps can link straight to them.
      const b = pathname.match(/^\/bookings\/([^/]+)$/)?.[1];
      const i = pathname.match(/^\/incidents\/([^/]+)$/)?.[1];
      if (b && state.step === 3 && b !== state.booking) update({ booking: b });
      if (i && state.step === 8 && i !== state.incident) update({ incident: i });
      if (Date.now() - lastActive.current > IDLE_MS) setIdle(true);
      if (!onSpot) {
        setRects([]);
        // Completion by navigation still counts when the step's persona is right (e.g. redirect after submit).
        if (rightPerson && step.doneWhen?.path?.test(pathname)) go(state.step + 1);
        return;
      }
      const found = (step.targets ?? []).map(find).filter((x): x is Element => x !== null);
      setRects(found.map((el) => el.getBoundingClientRect()));
      const primary = step.targets?.[0] ? find(step.targets[0]) : null;
      if (primary) seenTarget.current = true;

      const d = step.doneWhen;
      const done = d
        ? (d.path?.test(pathname) ?? false) || (d.text !== undefined && [d.text].flat().some(pageHas))
        : seenTarget.current && !primary;
      if (done) {
        go(state.step + 1);
        return;
      }
      if (step.targets?.length && !primary) {
        missingSince.current ??= Date.now();
        setMissing(Date.now() - missingSince.current > 4000);
      } else {
        missingSince.current = null;
        setMissing(false);
      }
    };
    tick();
    const id = window.setInterval(tick, 400);
    window.addEventListener("scroll", tick, { passive: true });
    window.addEventListener("resize", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("scroll", tick);
      window.removeEventListener("resize", tick);
    };
  }, [ready, state.open, state.step, state.booking, state.incident, onSpot, rightPerson, step, pathname, go, update]);

  // When idle, bring the next control into view.
  useEffect(() => {
    if (!idle || !onSpot || !step.targets?.[0]) return;
    find(step.targets[0])?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [idle, onSpot, step]);

  if (!ready) return null;

  if (!state.open) {
    return (
      <button
        data-guide-ui
        type="button"
        onClick={() => update({ open: true })}
        className="no-print fixed bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+12px)] left-4 z-[60] flex items-center gap-2 rounded-full bg-thread px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:brightness-110"
      >
        <Icon name="sparkle" size={16} />
        {state.step > 0 && state.step < STEPS.length - 1 ? `Demo guide · step ${state.step}` : "Demo guide"}
      </button>
    );
  }

  const last = state.step === STEPS.length - 1;
  const n = STEPS.length - 2; // steps between welcome and finish
  const person = step.persona ? (PEOPLE[step.persona] ?? step.persona) : null;

  let action: React.ReactNode = null;
  if (blocked) {
    action = (
      <p className="text-sm text-rose">
        This step needs the booking you created earlier.{" "}
        <button type="button" className="font-semibold underline" onClick={() => go(1)}>
          Start from the request
        </button>
      </p>
    );
  } else if (!rightPerson && step.persona) {
    action = (
      <form action={demoLoginAction}>
        <input type="hidden" name="userId" value={step.persona} />
        <input type="hidden" name="next" value={where ?? pathname} />
        <button className={`btn-primary w-full ${idle ? "guide-pulse" : ""}`}>
          <Icon name="user" size={16} />
          Sign in as {person?.split(" (")[0]}
        </button>
      </form>
    );
  } else if (!rightPlace && where) {
    action = (
      <Link href={where} className={`btn-primary w-full ${idle ? "guide-pulse" : ""}`}>
        <Icon name="arrowRight" size={16} />
        Take me there
      </Link>
    );
  }

  return (
    <>
      {onSpot &&
        rects.map((r, i) => (
          <div
            key={i}
            data-guide-ui
            aria-hidden
            className={`guide-ring pointer-events-none fixed z-[55] rounded-lg ${i === 0 ? "guide-ring-primary" : ""} ${idle && i === 0 ? "guide-ring-idle" : ""}`}
            style={{ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 }}
          >
            {i === 0 && (
              <span className="absolute -top-7 left-0 rounded-md bg-saffron px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-white shadow">
                {idle ? "👉 Click here next" : "Here"}
              </span>
            )}
          </div>
        ))}

      <aside
        data-guide-ui
        aria-label="Demo guide"
        aria-live="polite"
        className="no-print fixed bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+12px)] left-4 z-[60] max-h-[55vh] w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded-xl border border-line bg-card p-4 shadow-2xl max-sm:p-3"
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="label mb-0 flex items-center gap-1.5 text-thread">
            <Icon name="sparkle" size={13} />
            Demo guide{state.step > 0 && !last ? ` · step ${state.step} of ${n}` : ""}
          </p>
          <button type="button" onClick={() => update({ open: false })} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink" aria-label="Minimise the demo guide">
            <Icon name="x" size={15} />
          </button>
        </div>
        {state.step > 0 && !last && (
          <div className="mb-3 h-1 overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-thread transition-all" style={{ width: `${(state.step / n) * 100}%` }} />
          </div>
        )}
        <h2 className="font-semibold">{step.title}</h2>
        {person && <p className="mt-0.5 text-xs font-medium text-muted">As {person}</p>}
        {/* On phones the panel shares the screen with the page, so the explanation starts clamped. */}
        <p className={`mt-2 text-sm text-ink/85 ${expanded ? "" : "max-sm:line-clamp-3"}`}>{step.body}</p>
        {!expanded && (
          <button type="button" onClick={() => setExpanded(true)} className="text-xs font-semibold text-thread sm:hidden">
            More
          </button>
        )}

        {action && <div className="mt-3">{action}</div>}
        {onSpot && idle && !missing && step.targets && (
          <p className="mt-3 rounded-md bg-saffron-soft px-2.5 py-1.5 text-sm text-saffron">Still there? The next click is highlighted on the page.</p>
        )}
        {onSpot && missing && (
          <p className="mt-3 rounded-md bg-sunken px-2.5 py-1.5 text-sm text-muted">
            Can&apos;t see it? Scroll down, or someone may have done this already.{" "}
            <button type="button" className="font-semibold text-thread underline" onClick={() => go(state.step + 1)}>
              Skip this step
            </button>
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={() => go(state.step - 1)} disabled={state.step === 0} className="btn-ghost btn-sm disabled:opacity-40">
            Back
          </button>
          {state.step === 0 ? (
            <button type="button" onClick={() => go(1)} className={`btn-primary btn-sm ${idle ? "guide-pulse" : ""}`}>
              Start the tour
              <Icon name="arrowRight" size={14} />
            </button>
          ) : last ? (
            <button type="button" onClick={() => update({ step: 0, open: false, booking: undefined, incident: undefined })} className="btn-ghost btn-sm">
              Restart tour
            </button>
          ) : (
            <button type="button" onClick={() => go(state.step + 1)} className="btn-ghost btn-sm">
              {step.doneWhen && !step.doneWhen.path && step.doneWhen.text === undefined ? "Next" : "Skip"}
              <Icon name="arrowRight" size={14} />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
