// Shared (server + client) shape of bookings.aiConditionDiff.

export type VisionChange = { area: string; description: string; severity: "none" | "minor" | "major" };

export type VisionResult = {
  changes: VisionChange[];
  summary: string;
  confidence: "low" | "medium" | "high";
  suggestsDamageReview: boolean;
};

export type ConditionDiff =
  | { status: "pending"; requestedAt: number }
  | ({ status: "done"; source: "claude"; model: string; comparedAt: number; incidentId: string | null } & VisionResult)
  | { status: "unavailable"; reason: "no_api_key"; at: number }
  | { status: "error"; message: string; at: number; attempts: number };

/** A "pending" comparison older than this is treated as lost (e.g. the server restarted) and can be retried. */
export const STALE_PENDING_MS = 90_000;
