import type { Metadata } from "next";
import Link from "next/link";
import { loginAction } from "@/app/actions";
import { ActionForm, PasswordField, Submit } from "@/components/forms";
import { DemoAccounts } from "@/components/demo-accounts";
import { LogoMark } from "@/components/logo";
import { CopyButton } from "@/components/ds/client";
import { Icon } from "@/components/ds/icons";
import { DEMO_PASSWORD } from "@/lib/seed";

export const metadata: Metadata = { title: "Sign in · LoomLend" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : undefined;
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-14">
      <div className="enter">
        <LogoMark size={40} animated />
        <h1 className="h-display mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Welcome back</h1>
        <p className="mt-1 text-muted">{next?.startsWith("/scan") ? "Sign in to finish the hand-over. You'll land straight back on the item you scanned." : "Sign in to book, check in and keep your loans on track."}</p>
        <div className="card mt-6 p-5 sm:p-6">
          <ActionForm action={loginAction} className="space-y-4" toast={false}>
            {next && <input type="hidden" name="next" value={next} />}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required className="input" autoComplete="email" inputMode="email" placeholder="priya@northfield.demo" autoFocus />
            </div>
            <PasswordField autoComplete="current-password" />
            <Submit className="btn-primary w-full" pendingLabel="Signing in…">Sign in</Submit>
          </ActionForm>
          <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-dashed border-line-strong/70 bg-sunken/50 px-3 py-2 text-sm">
            <span className="text-muted">Demo password for every account</span>
            <CopyButton value={DEMO_PASSWORD} showValue label="Copy demo password" />
          </div>
        </div>
        <p className="mt-4 text-sm text-muted">
          New to LoomLend?{" "}
          <Link href="/register" className="font-medium text-thread underline-offset-4 hover:underline">Create an account</Link>
        </p>
      </div>
      <div className="enter [animation-delay:80ms]">
        <div className="mb-4 flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-saffron-soft text-saffron"><Icon name="users" size={18} /></span>
          <div>
            <h2 className="h-display text-2xl font-semibold">Or step into someone&apos;s shoes</h2>
            <p className="text-sm text-muted">One click, no password. Each person shows a different side of the workflow.</p>
          </div>
        </div>
        <DemoAccounts next={next} />
      </div>
    </div>
  );
}
