"use client";

export function PrintButton({ label = "Print tag" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn-primary min-h-11">
      {label}
    </button>
  );
}
