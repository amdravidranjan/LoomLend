import type { Metadata } from "next";
import Link from "next/link";
import { registerAction } from "@/app/actions";
import { ActionForm, PasswordField, Submit } from "@/components/forms";
import { Notice, PageHeader } from "@/components/ui";
import { Stepper } from "@/components/ds/primitives";
import { AFFILIATIONS } from "@/lib/catalog";

export const metadata: Metadata = { title: "Create an account · LoomLend" };

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader kicker="Join LoomLend" title="Create an account" description="Two minutes now; the facilities office takes it from there." />
      <Stepper
        className="mb-6"
        current={0}
        steps={[
          { label: "Create account", description: "Now" },
          { label: "ID verified", description: "Facilities office" },
          { label: "Add training", description: "Manager verifies" },
          { label: "Book", description: "Unlocked" },
        ]}
      />
      <div className="card space-y-5 p-5 sm:p-6">
        <Notice>New accounts start unverified. Most resources unlock once the facilities office checks your campus ID and a manager verifies the training you add.</Notice>
        <ActionForm action={registerAction} className="space-y-4" toast={false}>
          <div>
            <label className="label" htmlFor="name">Full name</label>
            <input id="name" name="name" required minLength={2} className="input" autoComplete="name" />
          </div>
          <div>
            <label className="label" htmlFor="email">Campus email</label>
            <input id="email" name="email" type="email" required className="input" autoComplete="email" inputMode="email" placeholder="you@northfield.edu" />
          </div>
          <PasswordField autoComplete="new-password" minLength={8} label="Password" hint="At least 8 characters. A short phrase is easier to remember than symbols." />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="department">Department / organisation</label>
              <input id="department" name="department" required minLength={2} className="input" placeholder="ECE" autoComplete="organization" />
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
          <Submit className="btn-primary w-full" pendingLabel="Creating your account…">Create account</Submit>
        </ActionForm>
      </div>
      <p className="mt-4 text-center text-sm text-muted">
        Just looking? <Link href="/login" className="font-medium text-thread hover:underline">Try a demo account</Link> instead.
      </p>
    </div>
  );
}
