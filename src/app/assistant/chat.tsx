"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { AssistantMode, ChatTurn, OptionCard as Card, StreamEvent } from "@/lib/assistant-types";
import { Icon } from "@/components/ds/icons";
import { OptionCard } from "./option-card";

type Step = { id: string; label: string; status: "running" | "done" | "error"; detail?: string };
type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: Step[];
  options?: Card[];
  followups?: string[];
  mode?: AssistantMode;
  note?: string;
  error?: string;
  pending?: boolean;
};

const MAX_TURNS = 30;
const uid = () => Math.random().toString(36).slice(2, 10);

function loadTurns(key: string): Turn[] {
  try {
    const raw = sessionStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as Turn[]) : [];
    return Array.isArray(v) ? v.map((t) => ({ ...t, pending: false })) : [];
  } catch {
    return [];
  }
}
function saveTurns(key: string, turns: Turn[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(turns.slice(-MAX_TURNS)));
  } catch {
    /* storage full or blocked: the chat still works, it just won't survive a reload */
  }
}

/** What the model sees of earlier turns: the visible text plus a one-line summary of option cards. */
function toHistory(turns: Turn[]): ChatTurn[] {
  return turns
    .filter((t) => !t.pending && !t.error && t.content.trim())
    .map((t) => ({
      role: t.role,
      content:
        t.role === "assistant" && t.options?.length
          ? `${t.content}\n[Options shown: ${t.options.map((o) => `${o.resourceName} · ${o.slotLabel} · ${o.pathLabel}`).join("; ")}]`
          : t.content,
    }));
}

function plainText(t: Turn) {
  const opts = (t.options ?? []).map((o, i) => `${i + 1}. ${o.resourceName} — ${o.slotLabel} (${o.pathLabel})${o.eligible ? "" : " — not requestable yet"}\n   ${location.origin}${o.requestHref}`);
  return [t.content, ...opts].filter(Boolean).join("\n");
}

export function Chat({ storageKey, firstName, claude, suggestions }: { storageKey: string; firstName: string; claude: boolean; suggestions: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [restored, setRestored] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Restore the last conversation for this person (per browser tab session).
  useEffect(() => {
    const saved = loadTurns(storageKey);
    queueMicrotask(() => {
      setTurns(saved);
      setRestored(true);
    });
  }, [storageKey]);
  useEffect(() => {
    if (restored) saveTurns(storageKey, turns);
  }, [turns, restored, storageKey]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const update = useCallback((id: string, fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t))), []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      const history = toHistory(turns);
      const aId = uid();
      setTurns((ts) => [...ts, { id: uid(), role: "user", content: message }, { id: aId, role: "assistant", content: "", steps: [], pending: true }]);
      setInput("");
      setBusy(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, history }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          const msg = res.status === 401 ? "Your session has ended. Please sign in again." : (body.error ?? `The assistant is unavailable (${res.status}). Please try again.`);
          update(aId, (t) => ({ ...t, pending: false, error: msg }));
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const apply = (e: StreamEvent) =>
          update(aId, (t) => {
            switch (e.type) {
              case "mode":
                return { ...t, mode: e.mode, note: e.note };
              case "step": {
                const steps = [...(t.steps ?? [])];
                const i = steps.findIndex((s) => s.id === e.id);
                const s = { id: e.id, label: e.label, status: e.status, detail: e.detail };
                if (i >= 0) steps[i] = s;
                else steps.push(s);
                return { ...t, steps };
              }
              case "text":
                return { ...t, content: t.content + e.delta };
              case "options":
                return { ...t, options: e.options };
              case "followups":
                return { ...t, followups: e.items };
              case "error":
                return { ...t, error: e.message };
              case "done":
                return { ...t, pending: false };
            }
          });
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              apply(JSON.parse(line) as StreamEvent);
            } catch {
              /* ignore a malformed line rather than killing the answer */
            }
          }
        }
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        update(aId, (t) => ({ ...t, error: aborted ? "Stopped." : "Lost the connection. Check your network and try again." }));
      } finally {
        update(aId, (t) => ({ ...t, pending: false }));
        setBusy(false);
        abortRef.current = null;
        inputRef.current?.focus();
      }
    },
    [busy, turns, update],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    } else if (e.key === "Escape" && busy) {
      abortRef.current?.abort();
    } else if (e.key === "ArrowUp" && !input) {
      const last = [...turns].reverse().find((t) => t.role === "user");
      if (last) {
        e.preventDefault();
        setInput(last.content);
      }
    }
  }
  function clear() {
    abortRef.current?.abort();
    setTurns([]);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    inputRef.current?.focus();
  }
  async function copy(t: Turn) {
    try {
      await navigator.clipboard.writeText(plainText(t));
      setCopied(t.id);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }

  const lastMode = [...turns].reverse().find((t) => t.mode)?.mode ?? (claude ? "claude" : "basic");
  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-saffron uppercase">Booking concierge</p>
          <h1 className="h-display text-3xl font-semibold tracking-tight">Ask LoomLend</h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${lastMode === "claude" ? "border-indigo-200 bg-thread-soft text-thread" : "border-line bg-[var(--sunken)] text-muted"}`}
            title={
              lastMode === "claude"
                ? "Answers are written by Claude, using live LoomLend tools. Claude sees your department, membership type and training, never your name or email."
                : "Basic mode: a rule-based planner reads dates, times and keywords and runs the same live checks. No AI model is used."
            }
          >
            <Icon name={lastMode === "claude" ? "sparkle" : "wrench"} size={14} />
            {lastMode === "claude" ? "Claude · live data" : "Basic mode · rule-based"}
          </span>
          {turns.length > 0 && (
            <button type="button" onClick={clear} className="btn-ghost px-3 py-1.5 text-xs">
              Clear chat
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-[40vh] flex-col gap-5" aria-live="polite" aria-busy={busy}>
        {restored && turns.length === 0 && (
          <section className="card p-5">
            <p className="text-sm text-ink">
              Hi {firstName}. Tell me what you need to do and roughly when. I&apos;ll check what you&apos;re trained for, what&apos;s free and how it gets approved, then give you options you can
              request in one click.
            </p>
            <p className="mt-3 text-xs font-medium text-muted">Try one of these</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-line bg-card px-3 py-1.5 text-left text-sm text-ink hover:border-thread hover:text-thread">
                  {s}
                </button>
              ))}
            </div>
            {!claude && (
              <p className="mt-4 text-xs text-muted">
                Running in basic mode: no AI key is configured here, so a rule-based planner reads your dates and keywords. It uses the same live availability and eligibility checks.
              </p>
            )}
          </section>
        )}

        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-thread-solid px-4 py-2.5 text-sm whitespace-pre-wrap text-white" style={{ background: "var(--thread-solid)" }}>
                {t.content}
              </p>
            </div>
          ) : (
            <div key={t.id} className="flex flex-col gap-3">
              {t.note && <p className="text-xs text-muted">{t.note}</p>}
              {(t.steps?.length ?? 0) > 0 && (
                <ol className="space-y-1 text-xs text-muted" aria-label="What I checked">
                  {t.steps!.map((s) => (
                    <li key={s.id} className="flex items-start gap-2">
                      <span className="mt-0.5" aria-hidden>
                        {s.status === "running" ? (
                          <span className="inline-block size-3 animate-spin rounded-full border-2 border-[var(--line-strong)] border-t-[var(--thread)]" />
                        ) : s.status === "error" ? (
                          <Icon name="alert" size={13} className="text-rose" />
                        ) : (
                          <Icon name="check" size={13} className="text-teal" />
                        )}
                      </span>
                      <span>
                        {s.label}
                        {s.status === "running" ? "…" : ""}
                        {s.detail && <span className="text-ink/70"> — {s.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {t.pending && !t.content && !(t.steps?.length ?? 0) && <p className="text-sm text-muted">Thinking…</p>}
              {t.content && <div className="text-sm leading-relaxed whitespace-pre-wrap text-ink">{t.content}</div>}
              {t.options && t.options.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {t.options.map((o, i) => (
                    <OptionCard key={`${o.resourceId}-${o.start}`} card={o} index={i} />
                  ))}
                </div>
              )}
              {t.error && (
                <p role="alert" className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-soft px-3 py-2 text-sm text-rose">
                  <Icon name="alert" size={16} />
                  {t.error}
                </p>
              )}
              {!t.pending && (t.content || t.options?.length) && (
                <div className="flex flex-wrap items-center gap-2">
                  {t.id === lastAssistant?.id &&
                    t.followups?.map((f) => (
                      <button key={f} type="button" disabled={busy} onClick={() => void send(f)} className="rounded-full border border-line px-3 py-1 text-xs text-ink hover:border-thread hover:text-thread disabled:opacity-50">
                        {f}
                      </button>
                    ))}
                  <button type="button" onClick={() => void copy(t)} className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-ink" aria-label="Copy this answer">
                    <Icon name={copied === t.id ? "check" : "copy"} size={13} />
                    {copied === t.id ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="sticky z-10 rounded-xl border border-line bg-card p-2 shadow-[var(--shadow-2)]" style={{ bottom: "calc(var(--tabbar-h, 0px) + 12px)" }}>
        <label htmlFor="assistant-input" className="sr-only">
          Describe what you need
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="assistant-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={1000}
            autoFocus
            placeholder="e.g. I need to film an interview Friday afternoon"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-ink outline-none placeholder:text-muted/70"
          />
          {busy ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className="btn-ghost">
              Stop
            </button>
          ) : (
            <button type="submit" className="btn-primary" disabled={!input.trim()}>
              Ask
            </button>
          )}
        </div>
        <p className="px-2 pt-1 text-[11px] text-muted">
          Enter to send · Shift+Enter for a new line · ↑ to edit your last message · Esc to stop. Suggestions only: nothing is booked until you request it.
        </p>
      </form>
    </div>
  );
}
