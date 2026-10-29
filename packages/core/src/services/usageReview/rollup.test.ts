/**
 * The operator's roll-up across workspaces, against PGlite, through the
 * extension seam: nothing without an operator; with one, every workspace's
 * day on the operator's own Briefings and to the observer — and only the Orgs
 * read with content carry anything a person wrote. The stricter of the
 * report's mode and the Org's mode now always wins.
 */
import type { OperatorRollup } from './types';
import { and, eq, like } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const seam = vi.hoisted(() => ({ operators: [] as string[], seen: [] as unknown[] }));
vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));
vi.mock('@/libs/extensions', async (original) => {
  const real = await original<typeof import('@/libs/extensions')>();
  return {
    ...real,
    usageReviewOperators: () => seam.operators,
    usageRollupObservers: () => (seam.operators.length > 0 ? [async (r: unknown) => void seam.seen.push(r)] : []),
  };
});

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, agentSchema, briefingSchema, conversationMessageSchema, conversationSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { runUsageReview } = await import('./UsageReviewService');
const { runOperatorRollup } = await import('./rollup');

const NOW = new Date('2026-10-29T13:00:00Z');
const at = (hoursAgo: number, s = 0) => new Date(NOW.getTime() - hoursAgo * 3_600_000 + s * 1000);

const judge = {
  bindTools: (tools: Array<{ name: string }>) => ({
    invoke: async () => ({
      tool_calls: [{
        name: tools[0]!.name,
        args: { intent: 'Plan an event', goal: 'Dates held', outcome: 'not_reached', outcome_reason: 'No dates came back.', reask_reason: null, time_fit: 'reasonable', effort_fit: 'right', effort_needed: null, thinking: 'appropriate', missing: [{ kind: 'connector', name: 'Google Calendar', why: 'The dates live on the calendar.' }], quality: 'poor', quality_reason: 'No dates.', themes: ['missing_connector'], better: 'Read the calendar before proposing dates.', rule: null },
      }],
    }),
  }),
} as never;

async function workspace(account: string, ws: string, name: string, title: string, contentSetting: boolean) {
  await db.insert(tenantAccountSchema).values({ id: account, name, slug: account, usageReviewContent: contentSetting });
  await db.insert(projectSchema).values({ id: ws, accountId: account, slug: ws, name, kind: 'shared' });
  await db.insert(agentSchema).values({ orgId: ws, projectId: ws, slug: 'planner', name: 'Planner', systemPrompt: 'x' });
  const [c] = await db.insert(conversationSchema).values({ orgId: ws, projectId: ws, agentSlug: 'planner', title, createdBy: 'user-1', createdAt: at(4) }).returning({ id: conversationSchema.id });
  await db.insert(conversationMessageSchema).values([
    { conversationId: c!.id, role: 'user', content: `${title}: hold three dates`, createdAt: at(4) },
    { conversationId: c!.id, role: 'assistant', content: 'I could not find the calendar.', status: 'failed', createdAt: at(4, 10) },
  ]);
  await runUsageReview(ws, { now: NOW, model: judge, file: false });
}

beforeAll(async () => {
  vi.stubEnv('VOCION_USAGE_REVIEW_DEFAULT', '');
  await workspace('acct-bellwater', 'proj-bellwater', 'Bellwater Hall', 'Bellwater Hall spring gala', true);
  await workspace('acct-kestrel', 'proj-kestrel', 'Kestrel Capital', 'Kestrel Capital board dinner', false);
  await db.insert(userSchema).values({ id: 'user-ops', email: 'ops@vocion.example', name: 'Operator' });
  await db.insert(accountMembershipSchema).values({ accountId: 'acct-bellwater', userId: 'user-ops', role: 'admin' });
});

afterEach(() => {
  seam.operators = [];
  seam.seen = [];
});

describe('the operator roll-up', () => {
  it('does nothing on a deployment that names no operator', async () => {
    expect(await runOperatorRollup({ now: NOW })).toEqual({ skipped: 'no_operator' });
  });

  it('lands on the operator\'s own Briefings and with the observer; only content Orgs carry what a person wrote', async () => {
    seam.operators = ['ops@vocion.example'];
    const out = await runOperatorRollup({ now: NOW });

    expect(out).toMatchObject({ workspaces: 2, observers: 1, mailed: { sent: false } });

    const rollup = seam.seen[0] as OperatorRollup;
    const bellwater = rollup.workspaces.find(w => w.orgId === 'proj-bellwater')!;
    const kestrel = rollup.workspaces.find(w => w.orgId === 'proj-kestrel')!;

    expect(bellwater).toMatchObject({ mode: 'content', why: 'org_setting', threads: 1 });
    expect(bellwater.worthALook[0]).toMatchObject({ thread: 'Bellwater Hall spring gala', better: 'Read the calendar before proposing dates.' });
    expect(bellwater.missing).toEqual([{ kind: 'connector', name: 'Google Calendar', why: 'The dates live on the calendar.' }]);
    expect(bellwater.worthALook[0]!.href).toMatch(/\/w\/proj-bellwater\/dashboard\/chat\?conversation=\d+/);

    expect(kestrel).toMatchObject({ mode: 'metadata', threads: 1, worthALook: [], missing: [], effort: [] });
    expect(kestrel.themes.map(t => t.label)).toContain('A turn failed or stopped short');
    expect(JSON.stringify(kestrel)).not.toContain('board dinner');

    const [personal] = await db.select({ id: projectSchema.id }).from(projectSchema).where(and(eq(projectSchema.kind, 'personal'), eq(projectSchema.ownerUserId, 'user-ops')));
    const briefs = await db.select().from(briefingSchema).where(and(eq(briefingSchema.orgId, personal!.id), like(briefingSchema.title, 'Usage across workspaces%')));

    expect(briefs).toHaveLength(1);
    expect(JSON.stringify(briefs[0]!.document)).toContain('Bellwater Hall spring gala');
    expect(JSON.stringify(briefs[0]!.document)).not.toContain('board dinner');
  });

  it('rolls an Org up as metadata once it switches content off, whatever its report was read as', async () => {
    seam.operators = ['ops@vocion.example'];
    await db.update(tenantAccountSchema).set({ usageReviewContent: false }).where(eq(tenantAccountSchema.id, 'acct-bellwater'));
    await runOperatorRollup({ now: NOW });
    const bellwater = (seam.seen[0] as OperatorRollup).workspaces.find(w => w.orgId === 'proj-bellwater')!;

    expect(bellwater).toMatchObject({ mode: 'metadata', worthALook: [], missing: [] });
    expect(JSON.stringify(bellwater)).not.toContain('spring gala');

    await db.update(tenantAccountSchema).set({ usageReviewContent: true }).where(eq(tenantAccountSchema.id, 'acct-bellwater'));
  });
});
