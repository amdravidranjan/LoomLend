"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { ViewTransition, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A thin thread across the top of the viewport while a navigation is in flight. Starts on
 * same-origin link clicks and GET form submits, finishes when the URL changes. Appears only
 * after 120 ms, so fast (prefetched) navigations show nothing at all (Doherty threshold).
 */
export function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const url = `${pathname}?${search}`;
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const delay = useRef(0);
  const [lastUrl, setLastUrl] = useState(url);
  if (url !== lastUrl) {
    setLastUrl(url);
    if (state === "loading") setState("done");
  }

  useEffect(() => {
    if (state !== "done") return;
    const t = window.setTimeout(() => setState("idle"), 400);
    return () => window.clearTimeout(t);
  }, [state]);

  useEffect(() => {
    const start = () => {
      window.clearTimeout(delay.current);
      delay.current = window.setTimeout(() => setState("loading"), 120);
    };
    const cancelIfSame = () => window.clearTimeout(delay.current);
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin || to.pathname.startsWith("/api/")) return;
      if (to.pathname === location.pathname && to.search === location.search) return;
      start();
    };
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement;
      if ((f.getAttribute("method") || "get").toLowerCase() === "get" && !e.defaultPrevented) start();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("popstate", cancelIfSame);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener("popstate", cancelIfSame);
    };
  }, []);

  useEffect(() => () => window.clearTimeout(delay.current), [url]);

  return (
    <div aria-hidden className="no-print pointer-events-none fixed inset-x-0 top-0 z-[90] h-[3px]">
      <div className={`ll-progress h-full origin-left ${state === "loading" ? "ll-progress-run" : state === "done" ? "ll-progress-done" : "opacity-0"}`} />
    </div>
  );
}

/**
 * Wraps page content so route changes cross-fade and rise (React <ViewTransition>). The header
 * and tab bar are named view-transition groups that stay still.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition key={pathname} enter="ll-page" exit="ll-page" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
