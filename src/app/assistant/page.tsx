import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { verifiedCertKeys } from "@/lib/assistant";
import { claudeAvailable } from "@/lib/assistant-claude";
import { Chat } from "./chat";

export const metadata: Metadata = { title: "Ask LoomLend" };

// Prompts that show off what this person can actually do (and one that shows an honest "not yet").
const BY_CERT: Record<string, string> = {
  "laser-cutter": "Cut acrylic panels on the laser cutter Thursday morning",
  electronics: "I need the oscilloscope tomorrow afternoon for 2 hours",
  "3d-printer": "Print a gearbox housing on Saturday, 4 hours",
  "av-studio": "I need to film an interview Friday afternoon",
  "chem-safety": "Fume hood for 3 hours next Monday morning for a recrystallisation",
  drone: "Aerial survey of the campus next week",
};

export default async function AssistantPage() {
  const user = await requireUser();
  const certs = await verifiedCertKeys(user.id);
  const prompts: string[] = [];
  if (user.affiliation === "external") {
    prompts.push("A meeting room for an investor pitch tomorrow at 3pm for an hour", "Can I use the laser cutter on Friday?");
  } else {
    for (const c of certs) if (BY_CERT[c] && prompts.length < 3) prompts.push(BY_CERT[c]);
    if (!certs.includes("av-studio")) prompts.push("I need to film an interview Friday afternoon");
    else if (!certs.includes("laser-cutter")) prompts.push("Cut acrylic on the laser cutter tomorrow");
    prompts.push("GPU for training a model tomorrow, 4 hours");
  }
  prompts.push("What have I booked?", "How does the waiting list work?");

  return (
    <Chat
      storageKey={`ll-assistant:${user.id}`}
      firstName={user.name.replace(/^Dr\.\s*/, "").split(" ")[0]}
      claude={claudeAvailable()}
      suggestions={[...new Set(prompts)].slice(0, 6)}
    />
  );
}
