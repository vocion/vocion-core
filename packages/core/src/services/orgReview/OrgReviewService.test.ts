/**
 * The weekly org review end to end against PGlite, the judge injected: what it
 * reads, what it files, what it refuses to file again, and that one
 * workspace's evidence never becomes another workspace's proposal.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, agentSchema, conversationSchema, projectSchema, tenantAccountSchema, toolCallSchema } = await import('@/models/Schema');
const { runOrgReview } = await import('./OrgReviewService');
const { readOrgSignals } = await import('./signals');

const ORG = 'org_review_main';
const OTHER = 'org_review_other';
const NOW = new Date();
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

/**
 * A judge bound to the one report tool, answering with these decisions.
 * @param decisions - What it decides.
 */
function judgeSays(decisions: unknown[]) {
  return {
    bindTools: (tools: Array<{ name: string }>) => ({
      invoke: async () => ({ tool_calls: [{ name: tools[0]!.name, args: { decisions } }] }),
    }),
  } as never;
}

const broken = { bindTools: () => ({ invoke: async () => {
  throw new Error('model unavailable');
} }) } as never;

async function agent(org: string, slug: string, opts: { createdAt?: Date } = {}) {
  await db.insert(agentSchema).values({ orgId: org, projectId: org, slug, name: slug, description: `${slug} for Northwind`, systemPrompt: 'x', createdAt: opts.createdAt ?? ago(60) });
}

async function talked(org: string, slug: string, at: Date) {
  await db.insert(conversationSchema).values({ orgId: org, projectId: org, agentSlug: slug, title: 'Northwind follow-up', updatedAt: at, createdAt: at });
}

async function runs(org: string) {
  return db.select().from(actionRunSchema).where(and(eq(actionRunSchema.orgId, org), eq(actionRunSchema.actionId, 'org.change')));
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-review', name: 'Northwind', slug: 'northwind-review' });
  await db.insert(projectSchema).values([
    { id: ORG, accountId: 'acct-review', slug: 'northwind', name: 'Northwind', leadAgentSlug: 'chief' },
    { id: OTHER, accountId: 'acct-review', slug: 'contoso', name: 'Contoso Supply' },
  ]);
});

beforeEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(conversationSchema);
  await db.delete(agentSchema);
  await db.update(projectSchema).set({ orgReview: null }).where(eq(projectSchema.id, ORG));
  // The lead, idle like everyone but never proposed; an idle scout; a busy desk.
  await agent(ORG, 'chief');
  await agent(ORG, 'scout');
  await agent(ORG, 'deal-desk');
  await talked(ORG, 'deal-desk', ago(1));
});

describe('what the review files', () => {
  it('files the judge\'s change as a pending org.change carrying core\'s evidence, and never the lead', async () => {
    const result = await runOrgReview(ORG, { now: NOW, consolidate: false, model: judgeSays([{ finding: 1, change: 'retire_agent', headline: 'Retire scout — no runs in 60 days', reason: 'It has never run.', confidence: 0.85 }]) });

    expect(result).toMatchObject({ findings: 1, judged: 'model', filed: [{ kind: 'retire_agent', target: 'scout', outcome: 'created', status: 'pending' }] });

    const [run] = await runs(ORG);

    expect(run!.input).toMatchObject({
      change: { kind: 'retire_agent', agentSlug: 'scout' },
      signal: 'idle',
      evidence: expect.arrayContaining([{ label: 'Last run', value: 'never', href: '/dashboard/team-report/scout' }]),
      asOf: NOW.toISOString(),
    });
    expect(run!.proposal).toMatchObject({ agentSlug: 'org-review', confidence: 0.85, suggestedDecision: 'approve' });

    // Waiting for a person: the agent is untouched.
    const [scout] = await db.select().from(agentSchema).where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, 'scout')));

    expect(scout!.active).toBe('true');
  });

  it('refreshes its own open card next week rather than filing a second one', async () => {
    const judge = judgeSays([{ finding: 1, change: 'retire_agent', headline: 'Retire scout', reason: 'Unused.', confidence: 0.8 }]);
    await runOrgReview(ORG, { now: NOW, consolidate: false, model: judge });
    const again = await runOrgReview(ORG, { now: NOW, consolidate: false, model: judge });

    expect(again.filed).toEqual([expect.objectContaining({ outcome: 'refreshed' })]);
    expect(await runs(ORG)).toHaveLength(1);
  });

  it('does not ask again about a change a person declined', async () => {
    const judge = judgeSays([{ finding: 1, change: 'retire_agent', headline: 'Retire scout', reason: 'Unused.', confidence: 0.8 }]);
    await runOrgReview(ORG, { now: NOW, consolidate: false, model: judge });
    await db.update(actionRunSchema).set({ status: 'rejected', decidedBy: 'usr-lili', decidedAt: new Date() }).where(eq(actionRunSchema.orgId, ORG));

    const again = await runOrgReview(ORG, { now: NOW, consolidate: false, model: judge });

    expect(again.filed).toEqual([]);
    expect(again.notFiled[0]!.why).toContain('a person already decided this');
  });

  it('does not ask again about a change a person undid', async () => {
    await runOrgReview(ORG, { now: NOW, consolidate: false, model: broken });
    await db.update(actionRunSchema).set({ status: 'undone', decidedBy: 'usr-lili', decidedAt: new Date() }).where(eq(actionRunSchema.orgId, ORG));

    const again = await runOrgReview(ORG, { now: NOW, consolidate: false, model: broken });

    expect(again.filed).toEqual([]);
    expect(again.notFiled[0]!.why).toContain('a person undid this change');
  });

  it('files the fallback when the judge cannot be read, and nothing when it keeps things as they are', async () => {
    const fallback = await runOrgReview(ORG, { now: NOW, consolidate: false, model: broken });

    expect(fallback).toMatchObject({ judged: 'fallback', filed: [{ kind: 'retire_agent', target: 'scout' }] });

    await db.delete(actionRunSchema);
    const kept = await runOrgReview(ORG, { now: NOW, consolidate: false, model: judgeSays([{ finding: 1, change: 'none', headline: 'Keep', reason: 'It runs at quarter end.', confidence: 0.7 }]) });

    expect(kept).toMatchObject({ filed: [], kept: [{ finding: 'idle:scout', reason: 'It runs at quarter end.' }] });
    expect(await runs(ORG)).toHaveLength(0);
  });

  it('files no more than the workspace\'s cap, and says what waited', async () => {
    await agent(ORG, 'archivist');
    await db.update(projectSchema).set({ orgReview: { maxProposals: 1 } }).where(eq(projectSchema.id, ORG));

    const result = await runOrgReview(ORG, { now: NOW, consolidate: false, model: broken });

    expect(result.filed).toHaveLength(1);
    expect(result.notFiled).toEqual([expect.objectContaining({ why: expect.stringContaining('over this review\'s cap of 1') })]);
  });

  it('does nothing in a workspace a person paused', async () => {
    await db.update(projectSchema).set({ pausedAt: new Date(), pausedBy: 'usr-lili', pausedNote: 'Quarter close' }).where(eq(projectSchema.id, ORG));

    expect(await runOrgReview(ORG, { now: NOW, consolidate: false, model: broken })).toMatchObject({ skipped: 'workspace_paused', filed: [] });

    await db.update(projectSchema).set({ pausedAt: null, pausedBy: null, pausedNote: null }).where(eq(projectSchema.id, ORG));
  });

  it('does nothing in a workspace that turned it off, unless asked outright', async () => {
    await db.update(projectSchema).set({ orgReview: { enabled: false } }).where(eq(projectSchema.id, ORG));

    expect(await runOrgReview(ORG, { now: NOW, consolidate: false, model: broken })).toMatchObject({ skipped: 'disabled', filed: [] });
    expect((await runOrgReview(ORG, { now: NOW, consolidate: false, model: broken, force: true })).filed).toHaveLength(1);
  });

  it('runs the learning compaction when it is due, and reports it', async () => {
    const result = await runOrgReview(ORG, { now: NOW, model: broken });

    expect(result.consolidation).toMatchObject({ ran: true, result: expect.objectContaining({ compactions: 0, retirements: 0 }) });
    expect((await runOrgReview(ORG, { now: NOW, model: broken })).consolidation).toEqual({ ran: false });
  });
});

describe('workspace scoping', () => {
  it('reads only its own workspace — another\'s activity under the same slug is not this agent\'s', async () => {
    await agent(OTHER, 'scout');
    await talked(OTHER, 'scout', ago(1));

    const signals = await readOrgSignals(ORG, { now: NOW });

    expect(signals.agents.map(a => a.slug).sort()).toEqual(['chief', 'deal-desk', 'scout']);
    expect(signals.agents.find(a => a.slug === 'scout')!.lastActiveAt).toBeNull();
    expect(signals.agents.find(a => a.slug === 'deal-desk')!.lastActiveAt).not.toBeNull();
  });

  it('counts a specialist reached only through its lead as working — its tool calls carry its slug', async () => {
    await db.insert(toolCallSchema).values({ orgId: ORG, agentSlug: 'scout', leadAgentSlug: 'chief', tool: 'search_knowledge', createdAt: ago(2) });
    // The same slug's work in another workspace is not this one's.
    await db.insert(toolCallSchema).values({ orgId: OTHER, agentSlug: 'deal-desk', tool: 'search_knowledge', createdAt: ago(1) });

    const signals = await readOrgSignals(ORG, { now: NOW });

    expect(signals.agents.find(a => a.slug === 'scout')!.lastActiveAt).not.toBeNull();
    expect((await runOrgReview(ORG, { now: NOW, consolidate: false, model: broken })).findings).toBe(0);

    await db.delete(toolCallSchema);
  });

  it('files only in the workspace it reviewed', async () => {
    await agent(OTHER, 'ghost');

    await runOrgReview(ORG, { now: NOW, consolidate: false, model: broken });

    expect((await runs(ORG)).map(r => (r.input as { change: { agentSlug: string } }).change.agentSlug)).toEqual(['scout']);
    expect(await runs(OTHER)).toEqual([]);

    await runOrgReview(OTHER, { now: NOW, consolidate: false, model: broken });

    expect((await runs(OTHER)).map(r => (r.input as { change: { agentSlug: string } }).change.agentSlug)).toEqual(['ghost']);
  });
});
