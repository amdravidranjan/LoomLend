"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/actions";
import { CONDITIONS } from "@/lib/catalog";

type Action = (state: FormState, fd: FormData) => Promise<FormState>;

/** A form bound to a server action that shows the action's success or error message. */
export function ActionForm({ action, children, className = "space-y-3" }: { action: Action; children: ReactNode; className?: string }) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && (
        <p role="alert" className="rounded-md border border-rose-200 bg-rose-soft px-3 py-2 text-sm text-rose">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="rounded-md border border-teal-200 bg-teal-soft px-3 py-2 text-sm text-teal">
          {state.ok}
        </p>
      )}
    </form>
  );
}

export function Submit({ children, className = "btn-primary", name, value }: { children: ReactNode; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function ConditionSelect({ name = "condition", defaultValue = "good" }: { name?: string; defaultValue?: string }) {
  return (
    <fieldset>
      <legend className="label">Condition</legend>
      <div className="flex flex-wrap gap-2">
        {CONDITIONS.map((c) => (
          <label key={c.key} className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-sm has-[:checked]:border-thread has-[:checked]:bg-thread-soft">
            <input type="radio" name={name} value={c.key} defaultChecked={c.key === defaultValue} className="accent-thread" />
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
  async function onFile(file: File | undefined) {
    setErr("");
    if (!file) return setData("");
    if (!file.type.startsWith("image/")) return setErr("Choose an image file.");
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 720 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    setData(canvas.toDataURL("image/jpeg", 0.7));
  }
  return (
    <div>
      <label className="label" htmlFor={`${name}-file`}>
        Photo (optional)
      </label>
      <input id={`${name}-file`} type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
      <input type="hidden" name={name} value={data} />
      {err && <p className="text-sm text-rose">{err}</p>}
      {data && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data} alt="Condition photo preview" className="mt-2 h-28 rounded-md border border-line object-cover" />
      )}
    </div>
  );
}
