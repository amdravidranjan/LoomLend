import { desc, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { verifyAuditChain } from "@/lib/audit";
import { AFFILIATIONS, CERTS, ROLE_LABEL, STRIKE_LIMIT } from "@/lib/catalog";
import { DAY, HOUR, currentTime, relative } from "@/lib/time";
import { resetDemoAction, reviewCertAction, verifyUserAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Badge, Empty, Notice, PageHeader, Pill, Section } from "@/components/ui";
import { Timeline } from "@/components/timeline";

export default async function AdminPage() {
  const user = await requireUser(["manager", "admin"]);
  const admin = user.role === "admin";
  const users = await db.select().from(schema.users).orderBy(schema.users.name);
  const inScope = (u: { department: string }) => admin || u.department === user.department;

  const pendingCerts = (await db.select().from(schema.certifications).where(eq(schema.certifications.status, "pending")))
    .map((c) => ({ c, u: users.find((u) => u.id === c.userId)! }))
    .filter(({ u }) => u && inScope(u));

  // Monopolisation watch: who holds the largest share of each resource's recent hours.
  const since = currentTime() - 30 * DAY;
  const recent = await db.select().from(schema.bookings).where(gt(schema.bookings.start, since));
  const held = recent.filter((b) => ["approved", "checked_out", "returned", "closed", "pending"].includes(b.status));
  const resources = await db.select().from(schema.resources);
  const watch = resources
    .filter((r) => inScope(r))
    .flatMap((r) => {
      const rows = held.filter((b) => b.resourceId === r.id);
      const total = rows.reduce((h, b) => h + (b.end - b.start) / HOUR, 0);
      if (total < 2) return [];
      const byUser = new Map<string, number>();
      rows.forEach((b) => byUser.set(b.userId, (byUser.get(b.userId) ?? 0) + (b.end - b.start) / HOUR));
      const [topId, topHours] = [...byUser.entries()].sort((a, b) => b[1] - a[1])[0];
      const waiting = recent.filter((b) => b.resourceId === r.id && b.status === "waitlisted").length;
      return [{ r, total, top: users.find((u) => u.id === topId)!, share: topHours / total, users: byUser.size, waiting }];
    })
    .sort((a, b) => b.share - a.share);

  const chain = admin ? await verifyAuditChain() : null;
  const log = admin ? await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.seq)).limit(40) : [];
  const openIncidents = await db.select().from(schema.incidents).where(inArray(schema.incidents.status, ["open"]));

  return (
    <div className="space-y-6">
      <PageHeader kicker={admin ? "Facilities office" : `${user.department} department`} title={admin ? "Admin desk" : "Verify & review"} />

      <Section title={`Training records to verify (${pendingCerts.length})`}>
        {pendingCerts.length === 0 ? <Empty>Nothing waiting.</Empty> : (
          <ul className="space-y-3">
            {pendingCerts.map(({ c, u }) => (
              <li key={c.id} className="rounded-lg border border-line bg-card p-4">
                <p className="font-medium">{u.name} · {CERTS[c.certKey]?.label}</p>
                <p className="text-sm text-muted">{u.department} · {AFFILIATIONS[u.affiliation]} · submitted {relative(c.createdAt)}</p>
                <p className="mt-1 text-sm">Evidence: {c.evidence}</p>
                <ActionForm action={reviewCertAction} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="certId" value={c.id} />
                  <input name="note" className="input max-w-sm flex-1" placeholder="Note (required to reject)" aria-label="Review note" />
                  <Submit className="btn-ok" name="verdict" value="verified">Verify</Submit>
                  <Submit className="btn-ghost" name="verdict" value="rejected">Reject</Submit>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">Check the training register or certificate before verifying. Your name is recorded against every verification.</p>
      </Section>

      <Section title="Fair-use watch (last 30 days)" aside={<span className="text-xs text-muted">Flags concentration; never acts on its own</span>}>
        {watch.length === 0 ? <Empty>Not enough recent usage to analyse.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted uppercase">
                <tr><th className="py-2 pr-3">Resource</th><th className="pr-3">Hours</th><th className="pr-3">People</th><th className="pr-3">Top user share</th><th>Waiting</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {watch.map((w) => (
                  <tr key={w.r.id}>
                    <td className="py-2 pr-3">{w.r.emoji} {w.r.name}</td>
                    <td className="pr-3">{w.total.toFixed(1)}</td>
                    <td className="pr-3">{w.users}</td>
                    <td className="pr-3">
                      {Math.round(w.share * 100)}% · {w.top?.name}{" "}
                      {w.share > 0.6 && w.users > 1 && <Pill tone="warn">Concentrated</Pill>}
                    </td>
                    <td>{w.waiting ? <Pill tone="info">{w.waiting}</Pill> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {admin && (
        <Section title="Accounts">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted uppercase">
                <tr><th className="py-2 pr-3">Person</th><th className="pr-3">Role</th><th className="pr-3">Identity</th><th className="pr-3">Standing</th><th>Action</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((u) => (
                  <tr key={u.id} className="align-top">
                    <td className="py-2 pr-3">
                      {u.name}
                      <span className="block text-xs text-muted">{u.email} · {u.department}</span>
                    </td>
                    <td className="pr-3">{ROLE_LABEL[u.role]}</td>
                    <td className="pr-3">{u.idVerified ? <Badge status="verified" label="Verified" /> : <Badge status="pending" label="Unverified" />}</td>
                    <td className="pr-3">{u.suspended ? <Badge status="rejected" label="Suspended" /> : `${u.strikes}/${STRIKE_LIMIT} strikes`}</td>
                    <td className="py-2">
                      {!u.idVerified ? (
                        <ActionForm action={verifyUserAction} className="flex gap-2">
                          <input type="hidden" name="userId" value={u.id} />
                          <input type="hidden" name="op" value="verify" />
                          <Submit className="btn-ok px-3 py-1">Verify ID</Submit>
                        </ActionForm>
                      ) : u.role === "member" ? (
                        <ActionForm action={verifyUserAction} className="flex flex-wrap gap-2">
                          <input type="hidden" name="userId" value={u.id} />
                          <input name="note" className="input w-40 py-1" placeholder="Reason" aria-label={`Reason for ${u.name}`} />
                          {u.suspended ? (
                            <Submit className="btn-ok px-3 py-1" name="op" value="reinstate">Reinstate</Submit>
                          ) : (
                            <Submit className="btn-ghost px-3 py-1" name="op" value="suspend">Suspend</Submit>
                          )}
                        </ActionForm>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">Emails are visible here only. Owners see a requester&apos;s name, department and standing, never contact details.</p>
        </Section>
      )}

      {admin && chain && (
        <Section title="The Weave: full audit log" aside={chain.ok ? <Pill tone="ok">✓ Chain intact · {chain.total} entries</Pill> : <Pill tone="warn">Chain broken at #{chain.brokenAt}</Pill>}>
          <p className="mb-4 text-sm text-muted">
            Every entry stores the SHA-256 hash of the previous one, so editing or deleting any past record breaks the chain and shows up here. {openIncidents.length} incident(s) open.
          </p>
          <Timeline entries={log} showHash />
        </Section>
      )}

      {admin && (
        <Section title="Demo controls">
          <Notice tone="warn">Resets every booking, incident and notification to the starting demo state. Use between judging sessions.</Notice>
          <ActionForm action={resetDemoAction} className="mt-3">
            <Submit className="btn-danger">Reset demo data</Submit>
          </ActionForm>
        </Section>
      )}
    </div>
  );
}
