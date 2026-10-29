import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { aiKeySource, anthropicClient } from "./ai-key";

// AI is advisory only: it writes a short note for the human reviewer. It never approves,
// rejects or penalises anyone. Without an API key (or on any error) a rule-based note is used.

export type AdvisoryNote = {
  source: "claude" | "rules";
  summary: string;
  risk: "low" | "medium" | "high";
  flags: string[];
};

const MODEL = "claude-opus-5-5";


const NOTE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    flags: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "risk", "flags"],
  additionalProperties: false,
} as const;

async function askClaude(system: string, content: string): Promise<AdvisoryNote | null> {
  const client = await anthropicClient({ timeout: 20_000, maxRetries: 1 });
  if (!client) return null;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low", format: { type: "json_schema", schema: NOTE_SCHEMA } },
      system,
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return null;
    const parsed = JSON.parse(text.text) as Omit<AdvisoryNote, "source">;
    return { source: "claude", ...parsed, flags: parsed.flags.slice(0, 5) };
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.error(`Claude API error ${err.status}: ${err.message}`);
    else console.error("AI advisory failed", err);
    return null;
  }
}

export type RequestContext = {
  resource: { name: string; category: string; usageRules: string; supervisionRequired: boolean; depositRequired: number; maxHours: number };
  requester: { affiliation: string; department: string; strikes: number; pastBookings: number; pastIncidents: number };
  purposeType: string;
  purpose: string;
  hours: number;
  failedChecks: string[];
  competingRequests: number;
};

export function ruleRequestNote(c: RequestContext): AdvisoryNote {
  const flags: string[] = [];
  if (c.failedChecks.length) flags.push(...c.failedChecks.map((f) => `Unmet: ${f}`));
  if (c.requester.strikes) flags.push(`Requester has ${c.requester.strikes} strike(s)`);
  if (c.requester.pastIncidents) flags.push(`${c.requester.pastIncidents} past incident report(s)`);
  if (c.competingRequests) flags.push(`${c.competingRequests} competing request(s) for an overlapping slot`);
  if (c.purpose.trim().length < 25) flags.push("Purpose is very brief; consider asking for detail");
  if (c.resource.supervisionRequired) flags.push("Supervised session: staff must be present at check-in");
  const risk: AdvisoryNote["risk"] =
    c.failedChecks.length || c.requester.strikes >= 2 ? "high" : flags.length > 1 || c.requester.pastIncidents ? "medium" : "low";
  const summary =
    `${c.requester.affiliation[0].toUpperCase()}${c.requester.affiliation.slice(1)} from ${c.requester.department} requests ${c.hours.toFixed(1)} h for ${c.purposeType}. ` +
    (c.requester.pastBookings ? `${c.requester.pastBookings} completed booking(s) on record. ` : "First-time borrower. ") +
    (risk === "low" ? "No concerns detected by the rule checks." : "Review the flags before deciding.");
  return { source: "rules", summary, risk, flags };
}

export async function reviewRequest(c: RequestContext): Promise<AdvisoryNote> {
  const ai = await askClaude(
    "You help a lab manager at a college triage equipment and space booking requests. " +
      "Write a two-sentence neutral summary of the request and list concrete concerns a careful human reviewer should check " +
      "(fit between stated purpose and the resource, safety, unmet requirements, scheduling pressure, track record). " +
      "Do not recommend approval or rejection; the human decides. Rate overall risk low, medium or high.",
    JSON.stringify(c),
  );
  return ai ?? ruleRequestNote(c);
}

export type IncidentContext = {
  type: string;
  severity: string;
  description: string;
  resourceName: string;
  checkOutCondition?: string | null;
  returnCondition?: string | null;
  minutesLate?: number;
};

function ruleIncidentNote(c: IncidentContext): AdvisoryNote {
  const flags: string[] = [];
  if (c.checkOutCondition && c.returnCondition && c.checkOutCondition !== c.returnCondition)
    flags.push(`Condition changed from "${c.checkOutCondition}" at pick-up to "${c.returnCondition}" at return`);
  if (c.minutesLate && c.minutesLate > 0) flags.push(`Returned ${c.minutesLate} min late`);
  if (c.type === "safety") flags.push("Safety incident: inspect before next booking");
  const risk = c.severity === "high" || c.type === "safety" ? "high" : c.severity === "medium" ? "medium" : "low";
  return {
    source: "rules",
    summary: `${c.type[0].toUpperCase()}${c.type.slice(1)} report on ${c.resourceName}: ${c.description.slice(0, 160)}${c.description.length > 160 ? "…" : ""}`,
    risk,
    flags,
  };
}

export async function summarizeIncident(c: IncidentContext): Promise<AdvisoryNote> {
  const ai = await askClaude(
    "You summarise incident reports about shared college lab equipment for the manager who must resolve them. " +
      "Give a two-sentence factual summary, list evidence the manager should verify (condition records, timing, photos), " +
      "and rate how urgent the follow-up is. Never decide fault or penalties.",
    JSON.stringify(c),
  );
  return ai ?? ruleIncidentNote(c);
}

export async function aiEnabled() {
  return (await aiKeySource()) !== "none";
}
