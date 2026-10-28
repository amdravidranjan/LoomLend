import { registerAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Notice, PageHeader } from "@/components/ui";
import { AFFILIATIONS } from "@/lib/catalog";

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader kicker="Join LoomLend" title="Create an account" />
      <div className="card space-y-4 p-5">
        <Notice>
          New accounts start unverified. The facilities office checks your campus ID before you can book most resources, and managers verify training
          records you add.
        </Notice>
        <ActionForm action={registerAction}>
          <div>
            <label className="label" htmlFor="name">Full name</label>
            <input id="name" name="name" required className="input" autoComplete="name" />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required className="input" autoComplete="email" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password (8+ characters)</label>
            <input id="password" name="password" type="password" required minLength={8} className="input" autoComplete="new-password" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="department">Department / organisation</label>
              <input id="department" name="department" required className="input" placeholder="ECE" />
            </div>
            <div>
              <label className="label" htmlFor="affiliation">I am a</label>
              <select id="affiliation" name="affiliation" className="input">
                {Object.entries(AFFILIATIONS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted">We store your name, email, department and booking records only. Other members never see your email.</p>
          <Submit>Create account</Submit>
        </ActionForm>
      </div>
    </div>
  );
}
