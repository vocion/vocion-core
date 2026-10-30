/**
 * `approvalRequired` MEANS A PERSON DECIDES — ALWAYS (2026-10-30, after #1549).
 *
 * The flag used to make a run wait for a decision, and the trust ladder could
 * then make that decision itself: a trust rule, a promoted rung or a
 * confident agent ran a Google Ads budget change, a journal entry or a batch
 * of declines with nobody looking. Here the ladder is set as permissive as it
 * goes — an explicit rule with no bar, the autonomous rung, low risk,
 * confidence 1, a conversation set to act — and every action that declares
 * the flag still waits. Fixtures are fictional (Northwind).
 */
import type { Action } from '@/libs/actions/types';
import type { Principal } from '@/services/authz';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');
// The most permissive ladder there is, for every kind: an explicit rule with
// no bar, at the top rung, low risk.
vi.mock('@/services/autonomy/AutonomyService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/autonomy/AutonomyService')>()),
  effectivePolicy: vi.fn(async (_orgId: string, actionId: string) => ({
    actionId,
    rung: 'autonomous',
    riskTier: 'low',
    minConfidence: 0,
    policy: { rung: 'autonomous' },
    trustRule: { threshold: 0, enabled: 'true' },
  })),
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { getAction, listActions, registerAction } = await import('@/libs/actions/registry');
const { isNeverAuto } = await import('@/libs/actions/neverAuto');
const { isOutwardOrIrreversible } = await import('@/libs/actions/outward');
const { executeAction, ladderVerdict, proposeAction } = await import('./ActionService');
const { promote } = await import('@/services/autonomy/AutonomyService');

const ORG = 'org_approval_required';
const MOST_PERMISSIVE = { confidence: 1, suggestedDecision: 'approve' as const };

/** Every action that says a person decides, read off the registry before any test re-registers one. */
const REQUIRED = listActions().filter(a => a.approvalRequired === true);

/** Money, books, ads, arbitrary MCP writes, declines, outside mail and infrastructure: the kinds that must be on that list. */
const MUST_REQUIRE = [
  'google_ads.set_budget',
  'google_ads.add_negatives',
  'google_ads.add_keywords',
  'google_ads.set_keyword_status',
  'google_ads.edit_ad_text',
  'google_ads.create_search_campaign',
  'ads.set_status',
  'finance.recategorize_expense',
  'finance.post_journal_entry',
  'mcp.call',
  'review.decline',
  'members.invite',
  'source.connect',
  'seo.save_profile',
  'site.publish_live',
  'deploy.release',
  'deploy.provision',
  'aws.mutate',
  'credentials.write',
];

function agent(): Principal {
  return { kind: 'agent', id: 'agent:media-buyer', grants: ['*'], autonomy: 5 as never, scope: { orgId: ORG } };
}

const executed = vi.fn(async () => ({ ok: true }));

/**
 * The registered action with its flags, grant and Undo kept and its outside
 * calls taken away, so the test reaches the gate and the execute without a
 * connected account.
 * @param id - A registered action id.
 */
function offline(id: string): Action {
  const real = getAction(id)!;
  return {
    ...real,
    inputSchema: z.record(z.string(), z.unknown()) as never,
    precheck: undefined,
    underway: undefined,
    onProposed: undefined,
    basisFor: undefined,
    stillHolds: undefined,
    holdForPerson: undefined,
    dedupKeyFor: undefined,
    ownsDedupKey: undefined,
    execute: executed as never,
  };
}

async function readRun(runId: number) {
  const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, runId));
  return row!;
}

beforeEach(async () => {
  executed.mockClear();
  await db.delete(actionRunSchema);
});

afterAll(async () => {
  await db.delete(actionRunSchema);
});

describe('the registry', () => {
  it('marks every kind that moves money, changes books or ads, writes through MCP, declines in bulk, mails outside or changes infrastructure', () => {
    expect(REQUIRED.map(a => a.id)).toEqual(expect.arrayContaining(MUST_REQUIRE));
  });
});

describe('an action that requires approval, at the most permissive ladder', () => {
  it.each(REQUIRED.map(a => [a.id, a] as const))('%s still waits for a person', async (_id, action) => {
    const verdict = await ladderVerdict(ORG, action, {}, MOST_PERMISSIVE, 'act');

    expect(verdict).toMatchObject({ mode: 'ask', source: 'never-auto' });
    // The same answer everywhere the platform asks: no promotion, no "Always allow", no clock default.
    expect(isNeverAuto(action)).toBe(true);
    expect(isOutwardOrIrreversible(action)).toBe(true);
  });

  it('runs a kind that does not require approval at the same ladder, so the ladder above really is wide open', async () => {
    const open = getAction('objects.update_meta')!;

    expect(open.approvalRequired).not.toBe(true);
    expect((await ladderVerdict(ORG, open, { objectType: 'deal' }, MOST_PERMISSIVE, 'act')).mode).toBe('execute');
  });
});

describe('the regressions, through proposeAction', () => {
  it.each([
    'google_ads.set_budget',
    'google_ads.create_search_campaign',
    'ads.set_status',
    'finance.post_journal_entry',
    'finance.recategorize_expense',
    'mcp.call',
    'review.decline',
  ])('an agent\'s %s at confidence 1 is pending, undecided and not run', async (id) => {
    registerAction(offline(id));
    const out = await proposeAction({ orgId: ORG, actionId: id, input: { note: 'Northwind spring campaign' }, principal: agent(), proposal: { ...MOST_PERMISSIVE, suggestedDecisionReason: 'Over budget by Friday.' }, conversationAutonomy: 'act' });
    const run = await readRun(out.runId);

    expect(out.status).toBe('pending');
    expect(run).toMatchObject({ status: 'pending', approvedByAgent: null, decidedBy: null });
    expect(executed).not.toHaveBeenCalled();
  });
});

describe('execution, the last line', () => {
  it.each(['agent:media-buyer', 'trust-ladder', 'by-default', 'system:sweep'])('refuses a google_ads.set_budget run decided by %s, and puts it back in Review', async (by) => {
    registerAction(offline('google_ads.set_budget'));
    const [run] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'google_ads.set_budget', input: { campaign_id: '4410' }, status: 'pending', invokedBy: 'agent:media-buyer', approvedByAgent: true, decidedBy: by, decidedAt: new Date(), proposal: { autoApproved: true, autoApprovedBy: 'trust-rule' } }).returning();

    await expect(executeAction(run!.id, ORG, { reviewedBy: by })).rejects.toMatchObject({ code: 'NEEDS_PERSON' });

    expect(executed).not.toHaveBeenCalled();

    const after = await readRun(run!.id);

    expect(after).toMatchObject({ status: 'pending', approvedByAgent: null, decidedBy: null, decidedAt: null });
    expect(after.proposal).not.toHaveProperty('autoApproved');
  });

  it('refuses a run the ladder stamped and released with no reviewer named', async () => {
    registerAction(offline('finance.post_journal_entry'));
    const [run] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'finance.post_journal_entry', input: {}, status: 'pending', invokedBy: 'agent:bookkeeper', approvedByAgent: true, decidedBy: 'agent:bookkeeper' }).returning();

    await expect(executeAction(run!.id, ORG)).rejects.toMatchObject({ code: 'NEEDS_PERSON' });
    expect(executed).not.toHaveBeenCalled();
  });

  it('runs it on a person\'s approval', async () => {
    registerAction(offline('google_ads.set_budget'));
    const [run] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'google_ads.set_budget', input: { campaign_id: '4410' }, status: 'pending', invokedBy: 'agent:media-buyer' }).returning();

    const out = await executeAction(run!.id, ORG, { reviewedBy: 'usr-dana' });

    expect(out.status).toBe('done');
    expect(executed).toHaveBeenCalledTimes(1);
  });
});

describe('the autonomy page', () => {
  it('never moves a kind that requires approval to a rung that runs it, even on a person\'s "always"', async () => {
    await expect(promote(ORG, 'google_ads.set_budget', 'usr-dana', { personChose: true })).rejects.toMatchObject({ code: 'NOT_EARNED' });
    await expect(promote(ORG, 'members.invite', 'usr-dana', { personChose: true })).rejects.toThrow(/waits for a person every time/);
  });
});
