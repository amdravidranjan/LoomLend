"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseTagPayload, tagHref } from "@/lib/tag-url";

// Minimal typings for the Shape Detection API (not in TypeScript's DOM lib everywhere).
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};
type WakeLockSentinelLike = { release(): Promise<void> };
type JsQR = (data: Uint8ClampedArray, width: number, height: number, opts?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" }) => { data: string } | null;

type Phase = "idle" | "starting" | "scanning" | "found" | "error";

const SCAN_INTERVAL_MS = 120;

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera permission was denied. Allow camera access for this site in your browser's address bar or settings, then press Start camera again. You can also type the code printed under the QR below.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device. Type the code printed under the QR tag below instead.";
  if (name === "NotReadableError" || name === "AbortError") return "The camera is busy in another app or tab. Close it and try again.";
  return "The camera could not be started. Type the code printed under the QR tag below instead.";
}

/** Mobile-first QR scanner: BarcodeDetector where available, jsQR otherwise. */
export function HandoverScanner() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const wake = useRef<WakeLockSentinelLike | null>(null);
  const lastBad = useRef("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [torch, setTorch] = useState<null | boolean>(null); // null = not supported
  const [engine, setEngine] = useState("");

  const stop = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    wake.current?.release().catch(() => {});
    wake.current = null;
    setTorch(null);
  }, []);

  // Always release the camera when leaving the page or hiding the tab.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && stream.current) {
        stop();
        setPhase("idle");
        setMessage("Scanning paused while the page was hidden. Press Start camera to continue.");
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [stop]);

  function handleText(text: string) {
    const tag = parseTagPayload(text);
    if (!tag) {
      if (lastBad.current !== text) {
        lastBad.current = text;
        setMessage("That QR code is not a LoomLend tag. Point the camera at the tag stuck on the item.");
      }
      return false;
    }
    navigator.vibrate?.(80);
    stop();
    setPhase("found");
    setMessage("Tag found. Opening the item…");
    router.push(tagHref(tag));
    return true;
  }

  async function start() {
    setMessage("");
    lastBad.current = "";
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setPhase("error");
      setMessage("This browser cannot open the camera here (it needs a secure https connection). Use your phone's camera app on the tag, or type the code below.");
      return;
    }
    setPhase("starting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      stream.current = s;
      const v = video.current!;
      v.srcObject = s;
      await v.play();
      const track = s.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorch(caps.torch ? false : null);
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } }).wakeLock;
        wake.current = (await wl?.request("screen")) ?? null;
      } catch {
        // Wake lock is a nicety; ignore if refused.
      }
      setPhase("scanning");
      await loop(v);
    } catch (e) {
      stop();
      setPhase("error");
      setMessage(cameraError(e));
    }
  }

  async function loop(v: HTMLVideoElement) {
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    let detector: BarcodeDetectorLike | null = null;
    if (Ctor) {
      try {
        const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
        if (formats.includes("qr_code")) detector = new Ctor({ formats: ["qr_code"] });
      } catch {
        detector = null;
      }
    }
    let jsqr: JsQR | null = null;
    if (!detector) jsqr = (await import("jsqr")).default as unknown as JsQR;
    setEngine(detector ? "built-in detector" : "jsQR");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const tick = async () => {
      if (!stream.current) return;
      try {
        if (v.readyState >= 2 && v.videoWidth) {
          if (detector) {
            const codes = await detector.detect(v);
            for (const c of codes) if (handleText(c.rawValue)) return;
          } else if (jsqr) {
            const scale = Math.min(1, 640 / v.videoWidth);
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const hit = jsqr(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (hit?.data && handleText(hit.data)) return;
          }
        }
      } catch {
        // A dropped frame is fine; keep scanning.
      }
      if (stream.current) timer.current = window.setTimeout(tick, SCAN_INTERVAL_MS);
    };
    tick();
  }

  async function toggleTorch() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  }

  const live = phase === "scanning" || phase === "starting";

  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-2xl bg-ink">
        <video ref={video} playsInline muted className={`h-full w-full object-cover ${live ? "" : "invisible"}`} aria-label="Camera preview for scanning the QR tag" />
        {live && (
          <div aria-hidden className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
        )}
        {!live && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-white/85">
            <div>
              <svg viewBox="0 0 24 24" className="mx-auto mb-3 size-14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
                <rect x="8" y="8" width="8" height="8" rx="1" />
              </svg>
              <p className="text-sm">{phase === "found" ? "Tag found." : "Point your camera at the LoomLend tag on the item."}</p>
            </div>
          </div>
        )}
      </div>

      <div className="mx-auto flex max-w-md gap-2">
        {live ? (
          <button type="button" onClick={() => { stop(); setPhase("idle"); }} className="btn-ghost min-h-12 flex-1 text-base">
            Stop camera
          </button>
        ) : (
          <button type="button" onClick={start} className="btn-primary min-h-12 flex-1 text-base" disabled={phase === "found"}>
            {phase === "error" ? "Try the camera again" : "Start camera"}
          </button>
        )}
        {live && torch !== null && (
          <button type="button" onClick={toggleTorch} aria-pressed={torch} className="btn-ghost min-h-12 px-5 text-base">
            {torch ? "Torch off" : "Torch on"}
          </button>
        )}
      </div>

      <p className={`mx-auto max-w-md text-center text-sm ${phase === "error" ? "text-rose" : "text-muted"}`} role="status" aria-live="polite">
        {message || (phase === "scanning" ? `Scanning… hold the tag inside the frame.${engine ? ` (${engine})` : ""}` : "")}
      </p>
    </div>
  );
}
