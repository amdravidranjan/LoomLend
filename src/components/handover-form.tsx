"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { handoverAction } from "@/app/actions-handover";
import { ConditionSelect, Submit } from "@/components/forms";
import { HandoverPhotoInput } from "@/components/handover-photo";

export type FormMethod = "qr" | "qr_demo" | "staff_code" | "staff_manual";

const OPTION: Record<FormMethod, { title: string; hint: string }> = {
  qr: { title: "Scanned the tag on the item", hint: "Your scan proves you are at the machine." },
  qr_demo: { title: "Simulate scanning the tag (demo)", hint: "Demo only: judges have no printed tag, so the server supplies the real tag secret. Recorded as simulated." },
  staff_code: { title: "Enter a staff code", hint: "The staff member generates a 6-digit code on their phone. Valid 5 minutes, one use." },
  staff_manual: { title: "Record in person (staff)", hint: "You are with the borrower at the item and inspect it together." },
};

type Props = {
  bookingId: string;
  purpose: "check_out" | "return";
  methods: FormMethod[];
  qrSecret?: string; // set on the scan page
  photoRequired: boolean;
  defaultCondition?: string;
  submitLabel: string;
  intro?: string;
  scanHref?: string; // link to the camera scanner (booking page)
};

/** Check-in / return with proof of presence, condition, notes and photo. */
export function HandoverForm({ bookingId, purpose, methods, qrSecret, photoRequired, defaultCondition = "good", submitLabel, intro, scanHref }: Props) {
  const [state, action] = useActionState(handoverAction, undefined);
  const [method, setMethod] = useState<FormMethod | undefined>(methods[0]);
  const id = useId();
  const noteId = `${id}-notes`;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="purpose" value={purpose} />
      {method && <input type="hidden" name="method" value={method} />}
      {qrSecret && <input type="hidden" name="k" value={qrSecret} />}
      {intro && <p className="text-sm text-muted">{intro}</p>}

      {scanHref && (
        <Link href={scanHref} className="btn-primary min-h-12 w-full text-base">
          <ScanIcon /> Scan the QR tag on the item
        </Link>
      )}

      {methods.length > 1 ? (
        <fieldset>
          <legend className="label">{scanHref ? "Or prove you are there another way" : "How are you proving you are at the item?"}</legend>
          <div className="grid gap-2">
            {methods.map((m) => (
              <label
                key={m}
                className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border bg-white p-3 text-sm has-[:checked]:border-thread has-[:checked]:bg-thread-soft/60 ${m === "qr_demo" ? "border-dashed border-saffron" : "border-line"}`}
              >
                <input type="radio" name={`${id}-method`} value={m} checked={method === m} onChange={() => setMethod(m)} className="mt-0.5 size-4 accent-thread" />
                <span>
                  <span className="font-medium">
                    {OPTION[m].title}
                    {m === "qr_demo" && <span className="ml-2 rounded bg-saffron-soft px-1.5 py-0.5 text-[11px] font-semibold text-saffron uppercase">Demo</span>}
                  </span>
                  <span className="block text-xs text-muted">{OPTION[m].hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : method ? (
        <p className="rounded-lg border border-line bg-white p-3 text-sm">
          <span className="font-medium">{OPTION[method].title}.</span> <span className="text-muted">{OPTION[method].hint}</span>
        </p>
      ) : null}

      {method === "staff_code" && (
        <div>
          <label className="label" htmlFor={`${id}-code`}>6-digit staff code</label>
          <input
            id={`${id}-code`}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            required
            className="input max-w-48 text-center font-mono text-2xl tracking-[0.4em]"
            placeholder="000000"
          />
        </div>
      )}

      <ConditionSelect defaultValue={defaultCondition} />
      <div>
        <label className="label" htmlFor={noteId}>Notes</label>
        <textarea
          id={noteId}
          name="notes"
          rows={2}
          maxLength={1000}
          className="input"
          placeholder={purpose === "check_out" ? "e.g. All probes present, small scratch on the left side." : "Anything the owner should know."}
        />
      </div>
      <HandoverPhotoInput required={photoRequired} label={purpose === "check_out" ? "Photo at pick-up" : "Photo at return"} />

      <Submit className="btn-primary min-h-12 w-full text-base">{method === "qr_demo" ? `${submitLabel} (simulated scan)` : submitLabel}</Submit>
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

export function ScanIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <path d="M7 12h10" />
    </svg>
  );
}
