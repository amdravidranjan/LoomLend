"use client";

import { useId, useRef, useState } from "react";

/**
 * Condition photo for hand-overs and statements. Downscaled to 720 px JPEG in the browser.
 * `required` makes the label say so; the server enforces it either way.
 */
export function HandoverPhotoInput({ name = "photo", required = false, label }: { name?: string; required?: boolean; label?: string }) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    setErr("");
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErr("Choose an image file.");
    setBusy(true);
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 720 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();
      const url = canvas.toDataURL("image/jpeg", 0.72);
      if (url.length > 1_400_000) setErr("That photo is too detailed to upload. Try again a little further away.");
      else setData(url);
    } catch {
      setErr("This photo format could not be read by your browser. Take the photo again, or choose a JPEG/PNG.");
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setData("");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label ?? "Condition photo"} {required ? <span className="text-rose">(required)</span> : <span className="normal-case">(strongly encouraged)</span>}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          id={id}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="min-h-11 text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-line file:bg-card file:px-4 file:text-sm file:font-medium"
          aria-describedby={`${id}-hint`}
        />
        {data && (
          <button type="button" onClick={clear} className="btn-ghost min-h-11">
            Remove photo
          </button>
        )}
      </div>
      <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
        {required ? "Needed because a deposit or supervision applies. " : ""}Show the whole item in good light; it is compared with the other photo later.
      </p>
      <input type="hidden" name={name} value={data} />
      {busy && <p className="text-sm text-muted" role="status">Preparing photo…</p>}
      {err && <p className="text-sm text-rose" role="alert">{err}</p>}
      {data && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data} alt="Preview of the photo you will submit" className="mt-2 h-32 rounded-md border border-line object-cover" />
      )}
    </div>
  );
}
