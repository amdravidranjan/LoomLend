import { DEMO_ACCOUNTS } from "@/lib/seed";
import { ROLE_LABEL } from "@/lib/catalog";
import { demoLoginAction } from "@/app/actions";

const ORDER = ["member", "owner", "manager", "admin"] as const;

export function DemoAccounts({ next }: { next?: string }) {
  return (
    <div className="space-y-5">
      {ORDER.map((role) => (
        <div key={role}>
          <h3 className="label">{ROLE_LABEL[role]}s</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {DEMO_ACCOUNTS.filter((a) => a.role === role).map((a) => (
              <form key={a.id} action={demoLoginAction}>
                <input type="hidden" name="userId" value={a.id} />
                {next && <input type="hidden" name="next" value={next} />}
                <button className="card w-full p-3 text-left hover:border-thread focus-visible:outline-2 focus-visible:outline-thread">
                  <span className="block font-medium">{a.name}</span>
                  <span className="block text-xs text-muted">{a.blurb}</span>
                </button>
              </form>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
