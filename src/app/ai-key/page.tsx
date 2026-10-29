import type { Metadata } from "next";
import Link from "next/link";
import { aiKeySource } from "@/lib/ai-key";
import { removeAiKeyAction, saveAiKeyAction } from "@/app/actions-ai-key";
import { ActionForm, Submit } from "@/components/forms";
import { Notice, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = { title: "Claude API key · LoomLend" };

const FEATURES = [
  ["Booking assistant", "Claude plans with live tools: search, eligibility, free slots.", "A rule-based parser understands dates, times and keywords, then runs the same tools."],
  ["Photo comparison", "Claude compares check-in and return photos and lists what changed.", "A pixel-difference heatmap in your browser highlights changed areas."],
  ["Reviewer and incident notes", "Claude writes a short neutral summary for the person deciding.", "Rule-based checks list the same risk flags."],
];

export default async function AiKeyPage() {
  const source = await aiKeySource();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader kicker="Optional" title="Use your own Claude API key" description="For judges and reviewers who want to see the AI features running on Claude." />

      {source === "server" && <Notice tone="ok">This deployment already has its own Claude key, so AI features run on Claude for everyone. Nothing to add.</Notice>}
      {source === "visitor" && <Notice tone="ok">Your key is active for this browser session.</Notice>}
      {source === "none" && (
        <Notice>
          No key is set, so LoomLend is using its built-in fallbacks. Every journey still works end to end; the AI parts are replaced by transparent
          rules and each screen says which mode answered.
        </Notice>
      )}

      {source !== "server" && (
        <Section title={source === "visitor" ? "Replace or remove your key" : "Paste your key"}>
          <ActionForm action={saveAiKeyAction} resetOnSuccess>
            <div>
              <label className="label" htmlFor="apiKey">Claude API key</label>
              <input
                id="apiKey"
                name="apiKey"
                type="password"
                required
                autoComplete="off"
                spellCheck={false}
                className="input font-mono"
                placeholder="sk-ant-…"
              />
            </div>
            <Submit pendingLabel="Checking the key…">Check and use this key</Submit>
          </ActionForm>
          {source === "visitor" && (
            <ActionForm action={removeAiKeyAction} className="mt-3">
              <Submit className="btn-ghost" confirm={false}>Remove my key</Submit>
            </ActionForm>
          )}
          <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-muted">
            <li>The key is checked with one inexpensive, read-only call, then kept only in your browser, in an encrypted cookie that JavaScript can&apos;t read.</li>
            <li>It is never written to the database or logs, is used only for your own requests, and disappears when you close the browser.</li>
            <li>Usage is billed to your Anthropic account. A typical demo session costs a few cents.</li>
            <li>Get a key at <a className="text-thread underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.</li>
          </ul>
        </Section>
      )}

      <Section title="What changes with a key">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted uppercase">
              <tr>
                <th className="py-2 pr-3">Feature</th>
                <th className="pr-3">With a key</th>
                <th>Without (fallback)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {FEATURES.map(([f, withKey, without]) => (
                <tr key={f}>
                  <td className="py-2 pr-3 font-medium">{f}</td>
                  <td className="py-2 pr-3">{withKey}</td>
                  <td className="py-2 text-muted">{without}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">Either way, AI is advisory: approvals, rejections, incident outcomes and strikes are always made by a named person.</p>
      </Section>

      <p className="text-sm">
        <Link href="/assistant" className="text-thread hover:underline">Try the booking assistant →</Link>
      </p>
    </div>
  );
}
