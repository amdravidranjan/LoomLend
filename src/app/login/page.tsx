import Link from "next/link";
import { loginAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { DemoAccounts } from "@/components/demo-accounts";
import { PageHeader } from "@/components/ui";
import { DEMO_PASSWORD } from "@/lib/seed";

export default function LoginPage() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.6fr]">
      <div>
        <PageHeader kicker="Welcome back" title="Sign in" />
        <div className="card p-5">
          <ActionForm action={loginAction}>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required className="input" autoComplete="email" placeholder="priya@northfield.demo" />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" name="password" type="password" required className="input" autoComplete="current-password" />
            </div>
            <Submit>Sign in</Submit>
          </ActionForm>
          <p className="mt-4 text-sm text-muted">
            New here? <Link href="/register" className="text-thread underline">Create an account</Link>. Demo password for every account:{" "}
            <code className="rounded bg-paper px-1">{DEMO_PASSWORD}</code>
          </p>
        </div>
      </div>
      <div>
        <h2 className="h-display mb-1 text-2xl font-semibold">Or pick a demo person</h2>
        <p className="mb-4 text-sm text-muted">Each one shows a different side of the workflow.</p>
        <DemoAccounts />
      </div>
    </div>
  );
}
