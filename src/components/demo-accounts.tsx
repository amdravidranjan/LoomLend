import { DEMO_ACCOUNTS } from "@/lib/seed";
import { ROLE_LABEL } from "@/lib/catalog";
import { demoLoginAction } from "@/app/actions";
import { Avatar } from "@/components/ds/primitives";
import { Icon } from "@/components/ds/icons";

const ORDER = ["member", "owner", "manager", "admin"] as const;

/** What each persona is best for demonstrating (from the judges' guide). */
const TRY: Record<string, string> = {
  "u-priya": "Discover → request → check in → return",
  "u-arjun": "Training awaiting verification locks the laser cutter",
  "u-divya": "Capstone priority on busy slots",
  "u-farhan": "Waiting-list position, explained",
  "u-sneha": "Researcher-only fume hood access",
  "u-vikram": "Unverified ID: see what's locked and why",
  "u-meena": "Review competing laser-cutter requests",
  "u-rahul": "Instant-approval tools and a GPU box",
  "u-nisha": "Inspect a camera kit returned scratched and late",
  "u-sanjay": "Supervised fume-hood hand-overs",
  "u-arun": "Verify training; resolve incidents",
  "u-kavya": "Verify IDs, audit chain, reset demo data",
};

/** Featured personas for the landing page: one per role, the best five-minute path. */
export const FEATURED = ["u-priya", "u-meena", "u-arun", "u-kavya"];

function Persona({ a, next, featured = false }: { a: (typeof DEMO_ACCOUNTS)[number]; next?: string; featured?: boolean }) {
  return (
    <form action={demoLoginAction} className="h-full">
      <input type="hidden" name="userId" value={a.id} />
      {next && <input type="hidden" name="next" value={next} />}
      <button className={`card group flex h-full w-full items-start gap-3 text-left ${featured ? "p-4" : "p-3"}`} aria-label={`Sign in as ${a.name}, ${ROLE_LABEL[a.role]}`}>
        <Avatar name={a.name} size={featured ? 44 : 36} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{a.name}</span>
          </span>
          <span className="block text-xs text-muted">{a.blurb}</span>
          {TRY[a.id] && (
            <span className="mt-2 flex items-start gap-1.5 text-xs font-medium text-thread">
              <Icon name="arrowRight" size={13} className="mt-px transition-transform group-hover:translate-x-0.5" />
              {TRY[a.id]}
            </span>
          )}
        </span>
      </button>
    </form>
  );
}

/** One-click sign-in as any fictional person, grouped by role. `only` limits to a featured set. */
export function DemoAccounts({ next, only }: { next?: string; only?: string[] }) {
  if (only) {
    return (
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {only.map((id) => {
          const a = DEMO_ACCOUNTS.find((x) => x.id === id);
          if (!a) return null;
          return (
            <div key={id} className="flex flex-col gap-1.5">
              <span className="label mb-0">{ROLE_LABEL[a.role]}</span>
              <div className="flex-1">
                <Persona a={a} next={next} featured />
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {ORDER.map((role) => (
        <div key={role}>
          <h3 className="label">{ROLE_LABEL[role]}s</h3>
          <div className="stagger grid gap-2 sm:grid-cols-2">
            {DEMO_ACCOUNTS.filter((a) => a.role === role).map((a) => (
              <Persona key={a.id} a={a} next={next} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
