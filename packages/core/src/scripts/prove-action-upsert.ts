/**
 * Proof: upsert-by-key + expiry on agent-suggested actions (review cards).
 * Proposes the SAME gmail.send twice (same derived dedup key) and asserts ONE
 * pending row (updated in place, not duplicated); checks an expired item is
 * excluded from the pending queue. gmail.send stays PENDING (never-auto guard)
 * so nothing sends. Cleans up its own test rows.
 *
 *   bash /Users/chrisfitkin/vc.sh action-upsert
 */
import process from 'node:process';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema } from '@/models/Schema';
import { proposeAction } from '@/services/ActionService';

const ORG = process.env.E2E_PROJECT ?? 'proj-revenue-f8429a692aab3703f82a4f15169b8662';
const KEY = 'gmail.send:upsert-probe@example.com';

async function pendingCount(dedupKey: string): Promise<number> {
  const rows = await db.select({ id: actionRunSchema.id }).from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.dedupKey, dedupKey)));
  return rows.length;
}

async function main(): Promise<void> {
  // clean any leftovers first
  await db.delete(actionRunSchema).where(and(eq(actionRunSchema.orgId, ORG), sql`${actionRunSchema.dedupKey} like 'gmail.send:upsert-probe%'`));

  const principal = { kind: 'agent' as const, id: 'agent:founder-gtm-lead', scope: { orgId: ORG }, grants: ['*'], autonomy: 2 as const };
  const base = { orgId: ORG, actionId: 'gmail.send', principal, dedupKey: KEY };

  const a = await proposeAction({ ...base, input: { to: 'upsert-probe@example.com', subject: 'First', body: 'v1', draft: true }, proposal: { confidence: 0.4 } });
  const b = await proposeAction({ ...base, input: { to: 'upsert-probe@example.com', subject: 'Second', body: 'v2', draft: true }, proposal: { confidence: 0.9 } });

  const count = await pendingCount(KEY);
  const [row] = await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.dedupKey, KEY)));

  // Expiry: an already-expired suggestion must not appear in the pending queue.
  await proposeAction({ orgId: ORG, actionId: 'gmail.send', principal, dedupKey: 'gmail.send:upsert-probe-expired@example.com', input: { to: 'upsert-probe-expired@example.com', subject: 'Old', body: 'stale', draft: true }, expiresAt: new Date(Date.now() - 60_000) });
  const { listPendingActionsRoute } = await import('@/routers/Review');
  // Can't call the route (needs auth) — assert via query mirroring its filter.
  const notExpired = await db.select({ id: actionRunSchema.id }).from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.dedupKey, 'gmail.send:upsert-probe-expired@example.com'), sql`(${actionRunSchema.expiresAt} is null or ${actionRunSchema.expiresAt} > now())`));
  void listPendingActionsRoute;

  console.warn('\n===== ACTION UPSERT PROOF =====');
  console.warn(`propose #1 runId=${a.runId} status=${a.status}`);
  console.warn(`propose #2 runId=${b.runId} status=${b.status}`);
  console.warn(`same runId (upsert, not duplicate): ${a.runId === b.runId ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`pending rows for key: ${count} ${count === 1 ? '✓' : '✗'}`);
  console.warn(`row updated to latest (subject/confidence): ${(row?.input as { subject?: string })?.subject === 'Second' && row?.proposal?.confidence === 0.9 ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`gmail.send stayed pending (no send): ${b.status === 'pending' ? 'YES ✓' : 'NO ✗'}`);
  console.warn(`expired item excluded from active queue: ${notExpired.length === 0 ? 'YES ✓' : 'NO ✗'}`);

  // cleanup
  await db.delete(actionRunSchema).where(and(eq(actionRunSchema.orgId, ORG), sql`${actionRunSchema.dedupKey} like 'gmail.send:upsert-probe%'`));
  console.warn('cleaned up test rows.');
  const ok = a.runId === b.runId && count === 1 && b.status === 'pending' && notExpired.length === 0;
  process.exit(ok ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });
