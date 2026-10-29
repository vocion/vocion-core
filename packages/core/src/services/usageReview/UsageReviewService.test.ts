/**
 * The daily usage review end to end against PGlite, the judge injected: it
 * skips a workspace nobody used, reads metadata only unless the Org lets it
 * read content (and then no word a person wrote reaches the judge or the
 * report), judges and files fixes as proposals when it may, and follows the
 * deployment's default and the operator's override.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, agentSchema, briefingSchema, conversationMessageSchema, conversationSchema, eventLogSchema, modelCallSchema, projectSchema, tenantAccountSchema, toolCallSchema } = await import('@/models/Schema');
const { runUsageReview } = await import('./UsageReviewService');
const { runUsageReviewCheckJob } = await import('@/services/jobs/usageReviewCheck');

const ACCOUNT = 'acct-usage';
const WS = 'proj-usage-northwind';
const NOW = new Date('2026-10-29T13:00:00Z');
const at = (hoursAgo: number, s = 0) => new Date(NOW.getTime() - hoursAgo * 3_600_000 + s * 1000);
const SECRET = 'Draft the Contoso Supply renewal quote with the confidential discount';

/**
 * A judge that records what it read and answers with one judgement.
 * @param seen - Collects what the judge was given to read.
 */
function judge(seen: string[]) {
  return {
    bindTools: (tools: Array<{ name: string }>) => ({
      invoke: async (messages: Array<{ content: unknown }>) => {
        seen.push(String(messages[1]?.content ?? ''));
        return {
          // What the call cost, as a provider reports it: the cap is kept from these.
          usage_metadata: { input_tokens: 4_000, output_tokens: 400, total_tokens: 4_400 },
          tool_calls: [{
            name: tools[0]!.name,
            args: {
              intent: 'Draft a renewal quote',
              goal: 'A quote ready to send',
              outcome: 'partial',
              outcome_reason: 'The quote came back without the pricing.',
              reask_reason: 'The first answer summarised the account instead of drafting.',
              time_fit: 'reasonable',
              effort_fit: 'too_low',
              effort_needed: 'standard',
              thinking: 'too_little',
              missing: [{ kind: 'connector', name: 'HubSpot', why: 'The deal\'s pricing lives in the CRM.' }],
              quality: 'poor',
              quality_reason: 'No pricing.',
              themes: ['re_asked', 'missing_connector'],
              better: 'Read the deal in the CRM before drafting the quote.',
              rule: 'Read the deal record before drafting any quote.',
            },
          }],
        };
      },
    }),
  } as never;
}

async function setting(value: boolean | null) {
  await db.update(tenantAccountSchema).set({ usageReviewContent: value }).where(eq(tenantAccountSchema.id, ACCOUNT));
}

/** One thread from yesterday: a request, a Quick answer, the same request again, a Standard answer with a failed tool. */
async function seedThread() {
  const [c] = await db.insert(conversationSchema).values({ orgId: WS, projectId: WS, agentSlug: 'deal-desk', title: 'Contoso Supply renewal quote', createdBy: 'user-ada', createdAt: at(5) }).returning({ id: conversationSchema.id });
  const id = c!.id;
  const [, a1, , a2] = await db.insert(conversationMessageSchema).values([
    { conversationId: id, role: 'user', content: SECRET, createdAt: at(5) },
    { conversationId: id, role: 'assistant', content: 'Contoso Supply is a customer since 2024.', status: 'complete', microCents: 300_000, createdAt: at(5, 6) },
    { conversationId: id, role: 'user', content: `${SECRET} please`, createdAt: at(5, 60) },
    { conversationId: id, role: 'assistant', content: 'Here is the quote.', status: 'complete', microCents: 4_000_000, createdAt: at(5, 95) },
  ]).returning({ id: conversationMessageSchema.id });
  await db.insert(modelCallSchema).values([
    { orgId: WS, accountId: ACCOUNT, feature: 'agent.turn', conversationId: id, messageId: a1!.id, model: 'claude-haiku-4-5-20251001', effortLevel: 'quick', createdAt: at(5, 2) },
    { orgId: WS, accountId: ACCOUNT, feature: 'agent.turn', conversationId: id, messageId: a2!.id, model: 'claude-sonnet-4-6', effortLevel: 'standard', createdAt: at(5, 70) },
  ]);
  await db.insert(toolCallSchema).values({ orgId: WS, projectId: WS, agentSlug: 'deal-desk', tool: 'read_document', error: 'not found', conversationId: id, createdAt: at(5, 80) });
  return id;
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-usage' });
  await db.insert(projectSchema).values({ id: WS, accountId: ACCOUNT, slug: 'northwind-usage', name: 'Northwind Sales', kind: 'shared' });
  await db.insert(agentSchema).values({ orgId: WS, projectId: WS, slug: 'deal-desk', name: 'Deal desk', description: 'Drafts quotes for Northwind', systemPrompt: 'x' });
});

beforeEach(async () => {
  await db.delete(conversationSchema);
  await db.delete(modelCallSchema);
  await db.delete(toolCallSchema);
  await db.delete(briefingSchema);
  await db.delete(actionRunSchema);
  await db.delete(eventLogSchema);
  await setting(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a day nobody used the workspace', () => {
  it('is skipped before anything is read, and the morning check raises nothing', async () => {
    const seen: string[] = [];
    const r = await runUsageReview(WS, { now: NOW, model: judge(seen) });

    expect(r.skipped).toBe('no_activity');
    expect(seen).toEqual([]);
    expect(await db.select().from(briefingSchema)).toEqual([]);
    expect(await runUsageReviewCheckJob(WS, { now: NOW.toISOString() })).toMatchObject({ due: false });
    expect(await db.select().from(eventLogSchema)).toEqual([]);
  });

  it('a used day raises the review once, however often the check ticks', async () => {
    await seedThread();

    expect(await runUsageReviewCheckJob(WS, { now: NOW.toISOString() })).toMatchObject({ due: true, deduped: false });
    expect(await runUsageReviewCheckJob(WS, { now: NOW.toISOString() })).toMatchObject({ due: true, deduped: true });

    const events = await db.select().from(eventLogSchema).where(eq(eventLogSchema.orgId, WS));

    expect(events.map(e => e.type)).toEqual(['usage.review_due']);
  });
});

describe('metadata only', () => {
  it('on a self-hosted install that never chose: no model reads anything, and no word a person wrote reaches the report', async () => {
    vi.stubEnv('VOCION_USAGE_REVIEW_DEFAULT', '');
    const id = await seedThread();
    const seen: string[] = [];
    const r = await runUsageReview(WS, { now: NOW, model: judge(seen) });

    expect(seen).toEqual([]);
    expect(r.report!.mode).toEqual({ mode: 'metadata', why: 'deployment_default' });
    expect(r.report!.threads).toMatchObject({ read: 1, judged: 0 });
    // Re-asks are still found — in code, by comparing the person's own messages.
    expect(r.report!.reasks).toMatchObject({ threads: 1, rate: 100 });

    const [brief] = await db.select().from(briefingSchema).where(eq(briefingSchema.id, r.briefingId!));
    const everything = JSON.stringify(brief);

    expect(everything).not.toContain('Contoso');
    expect(everything).not.toContain('confidential');
    expect(everything).toContain(`Thread ${id} with Deal desk`);
    expect(everything).toContain('Metadata only');
    // Nothing to file without reading what went wrong.
    expect(await db.select().from(actionRunSchema)).toEqual([]);
  });

  it('on Vocion Cloud when the Org switched it off', async () => {
    vi.stubEnv('VOCION_USAGE_REVIEW_DEFAULT', 'on');
    await setting(false);
    await seedThread();
    const seen: string[] = [];
    const r = await runUsageReview(WS, { now: NOW, model: judge(seen) });

    expect(seen).toEqual([]);
    expect(r.report!.mode).toEqual({ mode: 'metadata', why: 'org_setting' });
  });
});

describe('content', () => {
  it('on Vocion Cloud by default: the judge reads the thread with its facts, and the fixes are filed as proposals', async () => {
    vi.stubEnv('VOCION_USAGE_REVIEW_DEFAULT', 'on');
    const id = await seedThread();
    const seen: string[] = [];
    const r = await runUsageReview(WS, { now: NOW, model: judge(seen) });

    expect(r.report!.mode).toEqual({ mode: 'content', why: 'deployment_default' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(SECRET);
    expect(seen[0]).toContain('quick · claude-haiku-4-5-20251001');
    expect(seen[0]).toContain('re-asks (counted in code): 1');
    expect(r.report!.outcome).toMatchObject({ reached: 0, readable: 1, rate: 0 });
    expect(r.report!.missing).toEqual([{ kind: 'connector', name: 'HubSpot', why: 'The deal\'s pricing lives in the CRM.', refs: [`thread:${id}`] }]);
    expect(r.report!.effort).toEqual([{ ref: `thread:${id}`, ranAt: 'Quick, Standard', needed: 'Standard', why: 'needed more than it got' }]);

    const filed = await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.orgId, WS), eq(actionRunSchema.actionId, 'org.change')));

    expect(filed.map(f => (f.input as { change: { kind: string } }).change.kind).sort()).toEqual(['adopt_rule', 'request_capability']);
    expect(filed.every(f => f.status === 'pending' && (f.input as { signal?: string }).signal === 'usage')).toBe(true);

    const capability = filed.find(f => (f.input as { change: { kind: string } }).change.kind === 'request_capability')!;

    expect((capability.input as { evidence: Array<{ href?: string }> }).evidence[0]!.href).toBe(`/dashboard/chat?conversation=${id}`);

    // The report links every claim to its thread and lists the filed fixes.
    const [brief] = await db.select().from(briefingSchema).where(eq(briefingSchema.id, r.briefingId!));

    expect(brief!.teamSlug).toBe('workspace-manager');
    expect(JSON.stringify(brief!.document)).toContain(`(/dashboard/chat?conversation=${id})`);
    expect(JSON.stringify(brief!.document)).toContain('Suggested fixes');
  });

  it('never judges a thread that read a person\'s own connection, and never names it', async () => {
    vi.stubEnv('VOCION_USAGE_REVIEW_DEFAULT', 'on');
    const id = await seedThread();
    await db.insert(toolCallSchema).values({ orgId: WS, projectId: WS, agentSlug: 'deal-desk', tool: 'mail_read', conversationId: id, createdAt: at(5, 75) });
    const seen: string[] = [];
    const r = await runUsageReview(WS, { now: NOW, model: judge(seen), file: false });

    expect(seen).toEqual([]);
    expect(r.report!.threads).toMatchObject({ read: 1, judged: 0 });

    const [brief] = await db.select().from(briefingSchema).where(eq(briefingSchema.id, r.briefingId!));

    expect(JSON.stringify(brief)).not.toContain('Contoso');
  });

  it('on a self-hosted install the operator\'s override reads an Org with content whatever it says', async () => {
    vi.stubEnv('VOCION_USAGE_REVIEW_DEFAULT', '');
    vi.stubEnv('VOCION_USAGE_REVIEW_CONTENT_ORGS', 'northwind-usage');
    await setting(false);
    await seedThread();
    const seen: string[] = [];
    const r = await runUsageReview(WS, { now: NOW, model: judge(seen), file: false });

    expect(r.report!.mode).toEqual({ mode: 'content', why: 'operator_override' });
    expect(seen).toHaveLength(1);
  });

  it('stops judging at the day\'s cap and says so; the rest are read from structure', async () => {
    vi.stubEnv('VOCION_USAGE_REVIEW_DEFAULT', 'on');
    await seedThread();
    await seedThread();
    const seen: string[] = [];
    const r = await runUsageReview(WS, { now: NOW, model: judge(seen), capCents: 0, file: false, publish: false });

    // A zero cap still lets the first call through (nothing is known to cost yet), then stops.
    expect(r.report!.threads).toMatchObject({ read: 2, judged: 1, sampled: true });
    expect(r.report!.judgeNote).toContain('cap');
    expect(r.report!.judgeCents).toBeGreaterThan(0);
  });
});
