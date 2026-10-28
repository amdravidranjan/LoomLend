import { requireUser } from "@/lib/auth";
import { AFFILIATIONS, CATEGORIES, CERTS } from "@/lib/catalog";
import { DAY_NAMES } from "@/lib/time";
import { createResourceAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { PageHeader, Section } from "@/components/ui";

export default async function NewResourcePage() {
  const user = await requireUser(["owner", "manager", "admin"]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader kicker={`Listing for ${user.department}`} title="List a resource" />
      <ActionForm action={createResourceAction} className="space-y-6">
        <Section title="What is it?">
          <div className="grid gap-3 sm:grid-cols-[1fr_6rem_10rem]">
            <div>
              <label className="label" htmlFor="name">Name</label>
              <input id="name" name="name" required className="input" placeholder="Vinyl Cutter · Roland GS2-24" />
            </div>
            <div>
              <label className="label" htmlFor="emoji">Icon</label>
              <input id="emoji" name="emoji" defaultValue="🧰" maxLength={4} className="input text-center" />
            </div>
            <div>
              <label className="label" htmlFor="category">Type</label>
              <select id="category" name="category" className="input">
                {Object.entries(CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className="label" htmlFor="description">Description</label>
            <textarea id="description" name="description" required rows={3} className="input" placeholder="What it does, capacity, what's included." />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="location">Location</label>
              <input id="location" name="location" required className="input" placeholder="Fab Lab, Room M-104" />
            </div>
            <div>
              <label className="label" htmlFor="tags">Keywords for matching</label>
              <input id="tags" name="tags" className="input" placeholder="vinyl, sticker, decal, signage" />
            </div>
          </div>
        </Section>

        <Section title="When it is available">
          <fieldset>
            <legend className="label">Open days</legend>
            <div className="flex flex-wrap gap-2">
              {DAY_NAMES.map((d, i) => (
                <label key={d} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-sm has-[:checked]:border-thread has-[:checked]:bg-thread-soft">
                  <input type="checkbox" name="openDays" value={i} defaultChecked={i >= 1 && i <= 5} className="accent-thread" /> {d}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="label" htmlFor="openHour">Opens (hour)</label>
              <input id="openHour" name="openHour" type="number" min={0} max={23} defaultValue={9} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="closeHour">Closes (hour)</label>
              <input id="closeHour" name="closeHour" type="number" min={1} max={24} defaultValue={18} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="maxHours">Max hours / booking</label>
              <input id="maxHours" name="maxHours" type="number" min={1} max={24} defaultValue={3} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="weeklyHourCap">Fair-share cap (h / 7 days)</label>
              <input id="weeklyHourCap" name="weeklyHourCap" type="number" min={1} max={80} defaultValue={6} className="input" />
            </div>
          </div>
        </Section>

        <Section title="Who may use it, and how">
          <fieldset>
            <legend className="label">Open to</legend>
            <div className="flex flex-wrap gap-2">
              {Object.entries(AFFILIATIONS).map(([k, v]) => (
                <label key={k} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-sm has-[:checked]:border-thread has-[:checked]:bg-thread-soft">
                  <input type="checkbox" name="allowedAffiliations" value={k} defaultChecked={k !== "external"} className="accent-thread" /> {v}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-3">
            <legend className="label">Required training (verified by a manager)</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(CERTS).map(([k, v]) => (
                <label key={k} className="flex items-start gap-2 rounded-md border border-line bg-white px-2.5 py-1.5 text-sm has-[:checked]:border-thread has-[:checked]:bg-thread-soft">
                  <input type="checkbox" name="requiredCerts" value={k} className="mt-1 accent-thread" />
                  <span>
                    {v.label}
                    <span className="block text-xs text-muted">{v.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <label className="flex items-center gap-2"><input type="checkbox" name="requiresIdVerified" defaultChecked className="accent-thread" /> Verified campus ID required</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="supervisionRequired" className="accent-thread" /> Staff must supervise check-in</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="autoApprove" className="accent-thread" /> Instant approval when eligible and uncontested</label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
            <div>
              <label className="label" htmlFor="depositRequired">Deposit (₹)</label>
              <input id="depositRequired" name="depositRequired" type="number" min={0} defaultValue={0} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="usageRules">Usage rules shown before booking</label>
              <textarea id="usageRules" name="usageRules" required rows={2} className="input" placeholder="Safety rules, what to bring, clean-up expectations." />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">Instant approval is ignored when supervision is required: a person always reviews supervised resources.</p>
        </Section>
        <Submit>Publish listing</Submit>
      </ActionForm>
    </div>
  );
}
