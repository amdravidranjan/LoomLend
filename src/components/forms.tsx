"use client";

import { useActionState, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/actions";
import { CONDITIONS } from "@/lib/catalog";
import { Icon } from "@/components/ds/icons";
import { toast } from "@/components/ds/toast";
import { confirmAction, type ConfirmOptions } from "@/components/ds/confirm-dialog";

type Action = (state: FormState, fd: FormData) => Promise<FormState>;

/** Success messages that mark the high point of a journey get a small woven celebration. */
const PEAK = /^(Approved|Return confirmed|Checked in|Incident closed|Submitted\. A manager)/;

/**
 * A form bound to a server action. Shows the action's success or error message inline, moves
 * focus to it (so keyboard and screen-reader users land on the outcome), and raises a matching
 * toast. Backward compatible: `action`, `children`, `className` behave as before.
 */
export function ActionForm({
  action,
  children,
  className = "space-y-3",
  toast: showToast = true,
  celebrate,
  resetOnSuccess = false,
  id,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  /** Also raise a toast for the result (default true). */
  toast?: boolean;
  /** Force (true) or suppress (false) the celebration; by default it plays for peak moments. */
  celebrate?: boolean;
  /** Clear the fields after a successful submit. */
  resetOnSuccess?: boolean;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const msgRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state) return;
    msgRef.current?.focus({ preventScroll: false });
    if (state.ok && resetOnSuccess) formRef.current?.reset();
    if (!showToast) return;
    if (state.error) toast({ tone: "error", title: "That didn't go through", description: state.error, announce: false });
    else if (state.ok) toast({ tone: "success", title: state.ok, announce: false, celebrate: celebrate ?? PEAK.test(state.ok) });
  }, [state, showToast, celebrate, resetOnSuccess]);

  return (
    <form ref={formRef} action={formAction} className={className} id={id}>
      {children}
      {state?.error && (
        <p ref={msgRef} tabIndex={-1} role="alert" className="enter flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-soft px-3 py-2 text-sm text-rose outline-none focus-visible:ring-2 focus-visible:ring-rose/40">
          <Icon name="alert" size={16} className="mt-0.5" />
          <span>{state.error}</span>
        </p>
      )}
      {state?.ok && (
        <p ref={msgRef} tabIndex={-1} role="status" className="enter flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-soft px-3 py-2 text-sm text-teal outline-none focus-visible:ring-2 focus-visible:ring-teal/40">
          <Icon name="check" size={16} strokeWidth={2.2} className="mt-0.5" />
          <span>{state.ok}</span>
        </p>
      )}
    </form>
  );
}

function Spinner() {
  return (
    <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Submit button with a pending state. With several submit buttons in one form (Approve / Reject),
 * only the one that was pressed shows the spinner. Destructive buttons (`btn-danger`) ask for
 * confirmation by default; pass `confirm` (text or options) to confirm any button, or
 * `confirm={false}` to skip it.
 */
export function Submit({
  children,
  className = "btn-primary",
  name,
  value,
  confirm,
  pendingLabel,
  disabled,
  formNoValidate,
}: {
  children: ReactNode;
  className?: string;
  name?: string;
  value?: string;
  confirm?: boolean | string | ConfirmOptions;
  pendingLabel?: ReactNode;
  disabled?: boolean;
  formNoValidate?: boolean;
}) {
  const { pending, data } = useFormStatus();
  const confirmed = useRef(false);
  const mine = pending && (!name || !data || data.get(name) === (value ?? ""));
  const danger = className.includes("btn-danger");
  const needsConfirm = confirm === undefined ? danger : confirm !== false;

  async function onClick(e: MouseEvent<HTMLButtonElement>) {
    if (!needsConfirm || confirmed.current) {
      confirmed.current = false;
      return;
    }
    const btn = e.currentTarget;
    const form = btn.form;
    if (!form) return;
    // Let the browser validate required fields first, so we never confirm an invalid form.
    if (!formNoValidate && !form.checkValidity()) return;
    e.preventDefault();
    const label = typeof children === "string" ? children : "Continue";
    const opts: ConfirmOptions =
      typeof confirm === "object"
        ? confirm
        : {
            title: typeof confirm === "string" ? confirm : `${label}?`,
            body: typeof confirm === "string" ? undefined : "This can't be undone from here.",
            confirmLabel: label,
            tone: danger ? "danger" : "default",
          };
    if (await confirmAction(opts)) {
      confirmed.current = true;
      form.requestSubmit(btn);
    }
  }

  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      name={name}
      value={value}
      onClick={onClick}
      aria-busy={mine || undefined}
      formNoValidate={formNoValidate}
    >
      {mine ? (
        <>
          <Spinner />
          {pendingLabel ?? "Working…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function ConditionSelect({ name = "condition", defaultValue = "good" }: { name?: string; defaultValue?: string }) {
  const dot: Record<string, string> = { excellent: "bg-teal", good: "bg-teal/60", fair: "bg-amber", poor: "bg-saffron", damaged: "bg-rose" };
  return (
    <fieldset>
      <legend className="label">Condition</legend>
      <div className="flex flex-wrap gap-2">
        {CONDITIONS.map((c) => (
          <label
            key={c.key}
            className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-line bg-field px-3 py-1.5 text-sm transition-colors select-none hover:border-line-strong has-[:checked]:border-thread has-[:checked]:bg-thread-soft has-[:checked]:text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-thread"
          >
            <input type="radio" name={name} value={c.key} defaultChecked={c.key === defaultValue} className="sr-only" />
            <span className={`size-2 rounded-full ${dot[c.key] ?? "bg-muted"}`} aria-hidden />
            {c.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Lets the user attach a condition photo; it is downscaled in the browser before upload. */
export function PhotoInput({ name = "photo" }: { name?: string }) {
  const [data, setData] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function onFile(file: File | undefined) {
    setErr("");
    if (!file) return setData("");
    if (!file.type.startsWith("image/")) return setErr("Choose an image file.");
    setBusy(true);
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 720 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      setData(canvas.toDataURL("image/jpeg", 0.7));
    } catch {
      setErr("That image couldn't be read. Try another photo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <span className="label" id={`${name}-label`}>
        Photo (optional)
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={`${name}-file`} className="btn-ghost cursor-pointer">
          <Icon name="plus" size={16} />
          {data ? "Replace photo" : "Add a photo"}
        </label>
        <input id={`${name}-file`} type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} className="sr-only" aria-labelledby={`${name}-label`} />
        {busy && <span className="text-sm text-muted">Preparing…</span>}
        {data && (
          <button type="button" onClick={() => setData("")} className="text-sm text-muted underline-offset-2 hover:text-rose hover:underline">
            Remove
          </button>
        )}
      </div>
      <input type="hidden" name={name} value={data} />
      {err && (
        <p className="mt-1 text-sm text-rose" role="alert">
          {err}
        </p>
      )}
      {data && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data} alt="Condition photo preview" className="enter mt-2 h-28 rounded-lg border border-line object-cover" />
      )}
    </div>
  );
}

/** Password input with a show/hide toggle. */
export function PasswordField({
  id = "password",
  name = "password",
  label = "Password",
  autoComplete = "current-password",
  minLength,
  hint,
}: {
  id?: string;
  name?: string;
  label?: string;
  autoComplete?: string;
  minLength?: number;
  hint?: ReactNode;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input id={id} name={name} type={show ? "text" : "password"} required minLength={minLength} className="input pr-11" autoComplete={autoComplete} aria-describedby={hint ? `${id}-hint` : undefined} />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted hover:text-ink"
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          title={show ? "Hide password" : "Show password"}
        >
          <Icon name={show ? "eyeOff" : "eye"} size={18} />
        </button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
