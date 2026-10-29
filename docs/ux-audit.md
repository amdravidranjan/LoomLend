# LoomLend UX audit

Walked end to end as each demo role (member Priya, owner Meena, manager Dr. Arun, admin Kavya, unverified Vikram) at 1280 px and 390 × 844, in light and dark, with keyboard only and with `prefers-reduced-motion`. Findings are grouped by UX law. Severity: **S1** blocks or misleads a task, **S2** slows or confuses, **S3** polish.

Status: **Fixed** (done in the design-system pass), **Recommend** (page owned by another workstream; exact change listed for the integration pass in the last section).

## Findings

| # | Law | Where | Finding | Sev | Status |
|---|---|---|---|---|---|
| 1 | Fitts | Phone, whole app | Navigation wrapped into a horizontally scrolling strip at the top; check-in happens one-handed at the lab door. | S1 | **Fixed**: bottom tab bar (Discover, Bookings, raised **Scan** in the centre, Ask, More sheet); 44 px targets on coarse pointers. |
| 2 | Fitts | Buttons, inputs, chips | Many targets were 32–36 px tall. | S2 | **Fixed**: `btn` min 40 px (44 px on touch), inputs 44 px and 16 px text on touch (no iOS zoom), filter chips 36 px+. |
| 3 | Hick | Header | Five to six flat links plus logout competed equally. | S2 | **Fixed**: four primary links (+ Manage for staff), everything else behind **More**; account actions in an avatar menu; command palette for the long tail. |
| 4 | Jakob | Global | No search-anything, no shortcuts; patterns users expect from modern tools. | S2 | **Fixed**: Ctrl/⌘ K palette (pages, resources by name, your bookings by ref, theme), `g` chords, `/` focuses page search, `?` help sheet. |
| 5 | Doherty | All navigations | No feedback while a server-rendered page loads; slow DB pages felt frozen. | S1 | **Fixed**: route progress thread (after 120 ms only), route-aware `loading.tsx` skeletons, pending spinner on the pressed submit button only. |
| 6 | Doherty | Discover filters | Changing a select did nothing until "Search" was pressed. | S2 | **Fixed**: chips/selects/toggle apply instantly (still works without JS as a GET form). |
| 7 | Miller | Discover cards | Missing-requirement text listed every requirement inline. | S3 | **Fixed**: "4/5" count + first missing item; full fix hints in a tooltip. |
| 8 | Zeigarnik | Home | Open loops (return due, check-in today, pending training) were scattered. | S2 | **Fixed**: "Needs your attention" list on the dashboard with one action each; hero card for the one booking that matters now with a live countdown. |
| 9 | Peak-end | Approve, confirm return, check-in | Success was a plain green line that could be off-screen. | S2 | **Fixed**: inline message receives focus, matching toast, and a small woven celebration on peak moments (auto-detected from the action's message). |
| 10 | Von Restorff | Primary actions | Several pages had two or three equal-weight primary buttons. | S3 | **Fixed** on owned pages (one `btn-primary` per view, rest ghost/subtle). **Recommend** on booking detail (see I-3). |
| 11 | Tesler | Calendar | Users had to copy slot times into their calendar by hand. | S3 | **Fixed**: `.ics` download per booking (owner-only route), with 30-minute alarm. |
| 12 | Postel | Discover | Filters were forgotten between visits. | S3 | **Fixed**: last search remembered locally and *offered* back ("Pick up where you left off"), never applied silently. |
| 13 | Postel | Login after QR scan | Signing in from a scanned tag lost the destination. | S1 | **Fixed**: `/login?next=` carried through email form and every demo persona. |
| 14 | Aesthetic-usability | Global | Emoji icons (🔔, ✓, ✕) rendered differently per OS and read poorly in dark mode. | S2 | **Fixed** in shared components (single SVG icon set). **Recommend** for remaining glyphs (I-6). |
| 15 | Aesthetic-usability | Global | No dark mode; bright paper at night. | S2 | **Fixed**: full token-based dark theme, system/light/dark toggle (cookie + localStorage, no flash), raw palette classes on other pages remapped so they stay legible. |
| 16 | Accessibility | Forms | After submit, focus stayed on the button; screen-reader users missed the result. | S1 | **Fixed** in `ActionForm`: focus moves to the result, announced once (toast is silent for these). |
| 17 | Accessibility | Destructive actions | Reject / Reset demo data fired on one click. | S1 | **Fixed**: `btn-danger` submits confirm by default (native `<dialog>`, focus trapped, Esc cancels). **Recommend** `confirm` on ghost-styled destructive buttons (I-2). |
| 18 | Accessibility | Global | Focus rings inconsistent; skip link only partly styled; landmarks fine. | S2 | **Fixed**: one 2 px thread focus ring, fixed skip link, `main` focusable target, footer nav landmark. |
| 19 | Accessibility | Contrast | Muted text on paper was 4.9:1; several "soft" pairs failed in dark. | S2 | **Fixed**: muted 5.6:1; dark tokens tuned per role; solid fills use a deeper `-solid` step behind white text. |
| 20 | Layout stability | Phone | Single-column grids overflowed to 450–530 px because of nowrap buttons and edge tooltips. | S1 | **Fixed**: grid children may shrink, `overflow-x: clip` on body; verified `scrollWidth = viewport` on every owned page. |
| 21 | Layout stability | Times | Relative times computed once, drifting stale; numbers jittered. | S3 | **Fixed**: `RelativeTime` auto-updates, exact campus time on hover, tabular numerals. |
| 22 | Wayfinding | Tabs, header | No active-route indication. | S2 | **Fixed**: underline thread + icon tint in header, filled pill in tab bar, `aria-current`. |
| 23 | Trust | Unread | Clicking a notification never marked it read; no per-item control. | S2 | **Fixed**: opening marks read; per-item read/unread toggle; Unread filter; grouped by day. |
| 24 | Empty states | Bookings, notifications, discover | Dead-end "Nothing here." text. | S2 | **Fixed**: illustrated empty states with a next step (Discover, Ask, clear filters). |
| 25 | Errors | App | Default Next error and a 🧶 404. | S2 | **Fixed**: branded 404, route `error.tsx` with Retry (focuses heading), self-contained `global-error.tsx`. |
| 26 | Metadata | Tabs | Every page was "LoomLend · Share idle labs, safely". | S3 | **Fixed** on owned pages ("Discover · LoomLend"). **Recommend** for the rest (I-1). |
| 27 | Print | Booking / history | Printing included nav and toasts. | S3 | **Fixed**: print stylesheet hides chrome, prints link targets. |

## Role walkthrough notes

- **Member (Priya)**: Discover → card shows "You meet all 6 requirements" at a glance → request → home hero card counts down to the slot with **Scan to check in** and **Add to calendar** → bookings grouped by what to do next.
- **Unverified (Vikram)**: warning notice with a profile link on home; Discover cards show a lock and the count of requirements met; "Only what I can book" makes the gap explicit.
- **Owner (Meena)**: staff tiles lead the dashboard; "Needs your attention" points straight to `/manage#requests` and `#returns`.
- **Manager / Admin**: More menu holds Verify & review, Impact, Fairness; palette `g v`, `g i`.

## Integration recommendations (pages outside the design-system scope)

Exact changes for the lead's integration pass. All components referenced already exist and are backward compatible.

- **I-1 Titles.** The root layout has no title template, so every page sets its full title. Add `export const metadata = { title: "… · LoomLend" }`:
  - `src/app/manage/page.tsx` → `"Manage · LoomLend"`; `src/app/admin/page.tsx` → `"Admin desk · LoomLend"`; `src/app/policy/page.tsx` → `"Fair-use policy · LoomLend"`; `src/app/fairness/page.tsx` → `"Fairness ledger · LoomLend"`.
  - `src/app/impact/page.tsx`: change `"Impact"` → `"Impact · LoomLend"`. `src/app/assistant/page.tsx`: `"Ask LoomLend"` → `"Ask · LoomLend"`.
  - Dynamic pages: add `generateMetadata` returning the resource name, e.g. `src/app/resources/[id]/page.tsx` → `${r.name.split(" · ")[0]} · LoomLend`; `src/app/bookings/[id]/page.tsx` → `${bookingRef(b.id)} · ${r.name.split(" · ")[0]} · LoomLend`; `src/app/incidents/[id]/page.tsx` → `"Incident · LoomLend"`.
- **I-2 Confirm destructive ghost buttons.** `src/app/bookings/[id]/page.tsx` line ~185 `<Submit className="btn-ghost">Cancel booking</Submit>` → add `confirm={{ title: "Cancel this booking?", body: "Anyone on the waiting list moves up straight away.", confirmLabel: "Cancel booking", cancelLabel: "Keep it", tone: "danger" }}`. `src/app/admin/page.tsx` line ~127 Suspend and line ~61 Reject (training) → `confirm="Suspend this account?"` / `confirm="Reject this training record?"`. (Reject decision and Reset demo data are already `btn-danger` → confirm automatically.)
- **I-3 One primary per view.** `src/app/bookings/[id]/page.tsx` decision row: keep **Approve** `btn-ok`, make Reject `btn-ghost` with `confirm` (it still asks), so the reason-required rejection isn't visually equal to approval. Title: drop the emoji from `title={`${r.emoji} ${r.name}`}`; pass `back={{ href: "/bookings", label: "My bookings" }}` to `PageHeader` instead of the hand-rolled back link, and show the ref with `<CopyButton value={bookingRef(b.id)} showValue />` (from `@/components/ds/client`) inside the header children.
- **I-4 Status changes.** Where a page renders the status that an action just changed (booking detail header badge, manage rows), pass `animate` to `Badge` (`<Badge status={b.status} animate />`).
- **I-5 Add to calendar.** On `src/app/bookings/[id]/page.tsx`, for `approved`/`pending` bookings owned by the viewer, add `<a href={`/api/bookings/${b.id}/ics`} download className="btn-subtle"><Icon name="calendarPlus" size={16} />Add to calendar</a>`.
- **I-6 Replace text glyphs with icons.** `src/app/admin/page.tsx:142` `"✓ Chain intact"` → `<Pill tone="ok" icon="check">Chain intact · …</Pill>`; `src/app/scan/[resourceId]/page.tsx:110` "✓ Tag verified" → `<Icon name="check" size={14} />`; `src/app/fairness/rounds/[id]/page.tsx:198` and `verify.tsx:42-50` ✓/✗ → `<Icon name="check" />` / `<Icon name="x" />` with `title`; `src/app/fairness/_components/copy-hash.tsx` → reuse `CopyButton`.
- **I-7 "+ List a resource".** `src/app/manage/page.tsx:43` → `<Icon name="plus" size={16} />List a resource` (matches Discover).
- **I-8 Empty states.** `src/app/manage/page.tsx` "No returns waiting." and admin "Nothing waiting." → `<EmptyState compact illustration="check" title="All caught up" className="border-0" />` from `@/components/ds/primitives`.
- **I-9 Native file input.** `src/components/handover-photo.tsx:53` shows the OS "Choose File / No file chosen" control. Mirror `PhotoInput` in `forms.tsx`: visually hide the input (`className="sr-only"`) and use a `<label htmlFor=… className="btn-ghost">` with the plus icon, plus a Remove link.
- **I-10 Section ids.** The dashboard deep-links to `/manage#requests`, `#returns`, `#active`, `#incidents`. Pass `id="requests"` etc. to those `Section`s in `src/app/manage/page.tsx` so the links land (Section now accepts `id`, `icon`, `description`).
- **I-11 Page search.** On pages with their own search field (admin accounts table, fairness), add `data-page-search` to the input so `/` focuses it.
