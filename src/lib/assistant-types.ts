// Shared, serialisable types for the booking concierge (used by the route handler and the chat UI).

export type AssistantMode = "claude" | "basic";

export type ApprovalPath = "instant" | "review" | "supervised" | "draw" | "waitlist" | "blocked";

export type Requirement = {
  label: string;
  met: boolean;
  detail: string;
  /** What to do about it, when not met. */
  fix?: string;
  href?: string;
};

export type OptionCard = {
  resourceId: string;
  resourceName: string;
  emoji: string;
  location: string;
  department: string;
  /** Epoch ms, campus time when formatted. */
  start: number;
  end: number;
  /** "Fri 30 Oct, 2:00 pm – 4:00 pm" */
  slotLabel: string;
  why: string;
  requirements: Requirement[];
  eligible: boolean;
  path: ApprovalPath;
  pathLabel: string;
  pathDetail: string;
  /** Other people have pending requests that overlap this slot. */
  contested: boolean;
  requestHref: string;
};

export type StreamEvent =
  | { type: "mode"; mode: AssistantMode; note?: string }
  | { type: "step"; id: string; label: string; status: "running" | "done" | "error"; detail?: string }
  | { type: "text"; delta: string }
  | { type: "options"; options: OptionCard[] }
  | { type: "followups"; items: string[] }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "done" };

export type ChatTurn = { role: "user" | "assistant"; content: string };
