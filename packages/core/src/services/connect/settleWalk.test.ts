/**
 * THE WALK ANSWERS THE DECISION THAT STARTED IT: "Connect your systems" is a
 * setup Decision whose option opens the walk; Done answers it, typed, with
 * what happened as the record the agent reads next turn — no turn now, no
 * words in the person's mouth. Fixtures are fictional (Northwind).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/EventService', () => ({ ASK_DECIDED: 'ask.decided', emitEvent: vi.fn(async () => ({ eventId: 1, deduped: false, triggered: [] })) }));

const { db } = await import('@/libs/DB');
const { askSchema, conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const { escalate } = await import('@/services/decisions/escalate');
const { settleConnectSystems } = await import('./settleWalk');

const ORG = 'org_settle_walk';
const DANA = 'usr-dana';

async function conversation() {
  const [c] = await db.insert(conversationSchema).values({ orgId: ORG, agentSlug: 'workspace-lead', title: 'connect my tools' } as never).returning();
  return c!.id as number;
}

beforeEach(async () => {
  await db.delete(askSchema);
  await db.delete(conversationMessageSchema);
});

describe('Connect your systems', () => {
  it('reaches the person as one setup Decision whose option opens the walk', async () => {
    const id = await conversation();
    const out = await escalate({ type: 'card', card: { id: 'card_c', kind: 'connect-systems', title: 'Connect your systems', actions: [], source: {}, href: '/dashboard/chat?objective=connect-systems&named=hubspot', hrefLabel: 'Start', state: 'proposed' } }, { orgId: ORG, conversationId: id, userId: DANA, agentSlug: 'workspace-lead' });
    const d = out?.[0]?.type === 'decision' ? out[0].decision : null;

    expect(d).toMatchObject({ kind: 'setup', question: 'Connect your systems', state: 'open' });
    expect(d!.options).toEqual([expect.objectContaining({ id: 'start', label: 'Start', recommended: true, href: '/dashboard/chat?objective=connect-systems&named=hubspot' })]);
  });

  it('Done answers it, typed, and writes what happened where the next turn reads it — once', async () => {
    const id = await conversation();
    const out = await escalate({ type: 'card', card: { id: 'card_c', kind: 'connect-systems', title: 'Connect your systems', actions: [], source: {}, href: '/dashboard/chat?objective=connect-systems', state: 'proposed' } }, { orgId: ORG, conversationId: id, userId: DANA, agentSlug: 'workspace-lead' });
    const decisionId = out![0]!.type === 'decision' ? out![0]!.decision.id : 0;

    expect(await settleConnectSystems({ orgId: ORG, userId: DANA, conversationId: id, decisionId, summary: 'Connected HubSpot; Slack later.' })).toEqual({ settled: true });

    const [ask] = await db.select().from(askSchema);

    expect(ask).toMatchObject({ status: 'done', decision: 'start' });

    const rows = await db.select().from(conversationMessageSchema);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'decision' });
    expect(rows[0]!.content).toContain(`[decision #${decisionId} answered] Connect your systems`);
    expect(rows[0]!.content).toContain('What happened: Connected HubSpot; Slack later.');
    expect(await settleConnectSystems({ orgId: ORG, userId: DANA, conversationId: id, decisionId, summary: 'again' })).toEqual({ settled: false });
    expect(await db.select().from(conversationMessageSchema)).toHaveLength(1);
  });

  it('never answers another conversation\'s Decision', async () => {
    const id = await conversation();
    const out = await escalate({ type: 'card', card: { id: 'card_c', kind: 'connect-systems', title: 'Connect your systems', actions: [], source: {}, href: '/dashboard/chat?objective=connect-systems', state: 'proposed' } }, { orgId: ORG, conversationId: id, userId: DANA, agentSlug: 'workspace-lead' });
    const decisionId = out![0]!.type === 'decision' ? out![0]!.decision.id : 0;

    expect(await settleConnectSystems({ orgId: ORG, userId: DANA, conversationId: id + 1000, decisionId, summary: 'x' })).toEqual({ settled: false });
    expect(await settleConnectSystems({ orgId: 'org_someone_else', userId: DANA, conversationId: id, decisionId, summary: 'x' })).toEqual({ settled: false });
  });
});
