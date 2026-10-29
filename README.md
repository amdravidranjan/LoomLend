# LoomLend

**Every borrow, a thread on the loom.** LoomLend is a trusted sharing platform for a college campus. It lets owners share idle labs, equipment, tools and rooms with the students and researchers who need them, while the owners stay in control.

Built for the *Unlock Underused Equipment and Spaces* hackathon problem. The use case is one campus (the fictional Northfield Institute of Technology): Fab Lab machines, electronics benches, media kit, chemistry fume hoods and shared rooms.

## What makes it more than a booking system

- **Proof of presence at the machine.** Every resource has a printable QR tag. Check-in and return require scanning it with the phone camera (`/scan`), or a 6-digit one-time code from staff. Supervised items always need staff. Each hand-over records how it was proven.
- **AI photo comparison.** At return, Claude compares the check-in and return photos and lists what changed ("scratch on the lens hood"). That opens a damage report for a person to decide; the AI never decides. Without an API key, a pixel-difference heatmap runs in the browser instead.
- **Verifiable fair draws.** High-demand resources (laser cutter, 3D printer) allocate each day by weighted lottery. The seed's SHA-256 fingerprint is published before entries close (commit–reveal), so nobody can rig it. Anyone can re-run any draw in their browser at `/fairness/rounds/<id>` and get a ✓ or ✗. People who miss out earn fairness credits that raise their weight next time.
- **Fairness ledger** (`/fairness`): Gini coefficient and Lorenz curve per resource, share held by the top 10%, first-try success rate, and a "your fair share" panel.
- **Booking concierge** (`/assistant`). Ask "I need to film an interview Friday afternoon" and Claude uses real tools (search, eligibility, free-slot finder) to propose options you can request in one click. The server re-checks every option against live data. A rule-based mode works without a key, and the page always says which mode answered.
- **Impact dashboard** (`/impact`), the case for a principal: ₹ saved versus renting, use of idle hours, a demand heatmap, cross-department borrowing, unmet demand, and "buy a second unit" payback. CSV export and a print view.
- **Two-sided disputes.** The borrower, owner and manager each add their account before a decision. A strike requires confirming "I have read both sides", and the borrower can appeal once to an admin.
- **Production UX:**
  - a design system with a live style guide at `/design`, and dark mode;
  - page transitions, a mobile tab bar with Scan in the centre, the Ctrl/⌘K command palette and keyboard shortcuts;
  - confirmations on destructive actions, add-to-calendar (.ics), and toasts with focus moved to the result;
  - a written UX audit in `docs/ux-audit.md`.

## The lifecycle it covers

1. **List.** An owner publishes a resource with opening hours, a per-booking limit, a fair-share weekly cap, allowed membership types, required training, supervision, a deposit and usage rules.
2. **Discover.** Members describe their need in plain words ("cut acrylic panels"). Matching explains why each result matched, and every card shows whether you meet the requirements.
3. **Check eligibility.** Before asking, the member sees a checklist covering identity, membership, verified training, standing, hours, duration, the fair-share cap and the open-request limit, each with how to fix it.
4. **Request.** The request gets a transparent priority score. If the slot is already approved for someone else, it joins a waiting list. Owners can mark low-risk resources for instant approval.
5. **Review.** The owner or department manager approves, rejects or waitlists, and must give a reason to reject or waitlist. An advisory note (Claude, or rule-based) summarises risk but never decides.
6. **Competing requests.** Approving one request moves overlapping requests to the waiting list, each with an explanation. A cancellation promotes the best-placed waiting request.
7. **Check in.** The borrower records the condition at pick-up, with notes and an optional photo. Supervised resources can only be checked in by staff.
8. **Return.** The borrower records the return condition. A drop in condition automatically opens a damage report, and late returns are flagged.
9. **Confirm and resolve.** The owner inspects and confirms the return. A manager resolves incidents and decides whether to issue a strike. Three strikes suspend booking privileges until an admin reviews the account.
10. **History.** Every important action goes into a hash-chained activity log ("the Weave"). Both parties see the history for their booking; the admin sees the full chain and its integrity check.

Notifications cover requests, approvals, rejections, waiting-list moves, reminders 24 h before a slot, overdue returns, incidents and strikes.

## Try it (judges)

Open the deployed link, click **Try a demo account** and pick a person. All demo accounts use the password `demo1234`.

| Person | Role | What to try |
|---|---|---|
| Priya Natarajan | Student, fully trained | Discover → request → check in → return |
| Meena Sundar | Fab Lab owner | Manage → review competing laser-cutter requests (priority shown) → confirm returns |
| Dr. Arun Prakash | Mechanical manager | Verify Arjun's pending laser training; resolve incidents |
| Nisha Thomas | Media owner | Inspect the camera kit that came back scratched and 50 min late |
| Kavya Raman | Administrator | Verify Vikram's ID, the fair-use watch, the full audit log and chain check, **Reset demo data** |
| Vikram Shah | External founder, ID unverified | See which resources are locked and why |
| Farhan Ali | Student with 1 strike | See a waiting-list position and its explanation |

**Five-minute path:**
1. **Priya** → **Ask**: "I need to debug a circuit with an oscilloscope tomorrow afternoon" → **Request this slot** → send.
2. **Rahul** approves it.
3. **Priya** opens the booking → **Simulate scanning the tag (demo)** → check in → return it in "Fair" condition. A damage report opens automatically.
4. **Rahul** confirms the return. **Kavya** resolves the incident after reading both sides.
5. **Meena** → Laser Cutter → **Run draw now (demo)** → **Confirm winners** → open the draw and press **Verify**.
6. **Kavya** → **Impact**.

Supervised hand-over: **Priya** opens the approved laser booking. **Meena** generates a staff code on the same booking, and Priya enters it.

**Kavya → Admin → Reset demo data** restores everything between judging sessions.

*Demo mode* (the default) lets you check in right after approval even for a future slot, so the journey fits in one sitting. Set `DEMO_MODE=false` for real time windows and no-show detection.

## Tech stack

- **Next.js 16** (App Router, Server Components and Server Actions) with TypeScript, deployed on **Vercel**
- **Drizzle ORM** on **libSQL**: SQLite file locally, **Turso** in production
- **Tailwind CSS v4**
- **jose** signed session cookies, **bcryptjs** password hashing, **zod** input validation
- **Anthropic Claude API** (`@anthropic-ai/sdk`, model `claude-opus-5-5`, low effort, structured JSON output) for optional advisory notes, with a rule-based fallback
- Vercel Cron runs `/api/cron/sweep` daily; the same sweep also runs lazily on page loads

### Architecture

```
src/
  app/            pages (server components) + actions.ts (all mutations, server-side only)
  lib/rules.ts    pure eligibility, fair-share and priority rules (unit-tested)
  lib/workflow.ts booking state machine: request, decide, waitlist/promote, check-in/out, return, incidents, sweep
  lib/audit.ts    append-only SHA-256 hash-chained audit log + verifier
  lib/ai.ts       advisory notes (Claude or rules); never makes decisions
  lib/match.ts    explainable plain-language matching
  db/schema.ts    users, certifications, resources, bookings, incidents, notifications, audit_log
```

Every state change goes through `workflow.ts`, which re-checks permissions and requirements on the server, writes an audit entry and sends notifications.

## Trust, safety, privacy and fairness

- **Role-based access:** member, owner (own listings), manager (own department; verifies training, resolves incidents), admin (everything, verifies identity).
- **Human oversight:** AI notes are labelled advisory. Approvals, rejections, training verification, incident outcomes and strikes are always made by a named person, with a reason.
- **Privacy:** bookings are visible only to the borrower and the staff who manage that resource. Other members see only that a slot is taken. Owners never see email addresses. Claude receives no names or emails.
- **Fairness:** a fair-share weekly cap per resource, at most 3 open requests per person, a published priority formula (`/policy`), an explained waiting list, no-show penalties and a fair-use watch that flags concentration.
- **Integrity:** the audit log is append-only and hash-chained, so any edit to past records is detectable.

## Run locally

```bash
npm install
npm run db:setup     # creates local.db and loads demo data
npm run dev          # http://localhost:3000
npm test             # rule unit tests
```

## Deploy

1. Create a Turso database: `turso db create loomlend`, then get its URL and a token.
2. Push the schema and seed it: `TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:setup`
3. Import the repository in Vercel and set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SESSION_SECRET` and optionally `ANTHROPIC_API_KEY`.

## Testing notes

- `npm test`: 9 unit tests covering the eligibility checks (training, identity, affiliation, suspension, maintenance), opening hours and duration, the fair-share cap, the open-request limit, the priority formula, overlap detection and matching.
- Manual end-to-end runs in a browser:
  - list → discover → check slot → request → approve → check in → return in worse condition → automatic damage report → confirm return → manager resolves
  - two competing requests: approving one waitlists the other with a priority explanation
  - training verification unlocks a resource
  - the overdue booking is flagged and both parties are notified
  - the audit chain verifies as intact
- `npm run typecheck`, `npx eslint src` and `npm run build` all pass.

## Known limitations

- Deposits are recorded, not charged; there is no payment integration.
- Notifications are in-app only; there is no email or SMS.
- Training evidence is a text description. File upload and integration with the campus training register are future work.
- Condition photos are stored inline, downscaled, in the database. Production should use object storage.
- Single campus, single time zone (IST).

## Disclosure

Scaffolded with `create-next-app`. Uses the open-source libraries listed in `package.json`. Built during the hackathon with significant help from an AI coding assistant (Claude Code). All demo people, places and records are fictional.
