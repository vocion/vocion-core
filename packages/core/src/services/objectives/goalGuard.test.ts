/**
 * What a running goal may ask for, against PGlite: an import goal puts no
 * draft-email action in front of the person nobody asked for, and a denied
 * action is dropped — never re-asked, revised, until the person types new
 * direction. Fixtures are fictional (Northwind Expo).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, conversationMessageSchema, conversationSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { deniedReAsk, goalProposalRefusal, isOutreachAction, lastDirection, outreachAllowed, subjectOf } = await import('./goalGuard');
const { eq } = await import('drizzle-orm');

const ORG = 'proj-guard-gtm';
const STARTED = new Date('2026-10-10T09:00:00Z');
const DRAFT = { to: 'pat@northwind.example', subject: 'Northwind Expo data room', body: 'Open the Northwind Expo data room.', draft: true };

async function goalConversation(state: 'running' | 'stopped' = 'running'): Promise<number> {
  const [row] = await db.insert(conversationSchema).values({
    orgId: ORG,
    projectId: ORG,
    agentSlug: 'lead',
    title: 'Convert Northwind Expo leads',
    createdBy: 'usr-guard-dana',
    objective: { kind: 'goal', goalId: 1, state, startedAt: STARTED.toISOString() },
  }).returning({ id: conversationSchema.id });
  return row!.id;
}

async function said(conversationId: number, role: 'user' | 'decision', at: Date, runs?: unknown[]) {
  await db.insert(conversationMessageSchema).values({ conversationId, role, content: role === 'user' ? 'Import these leads' : 'Denied', createdAt: at, ...(runs ? { runsJson: runs as never } : {}) });
}

async function denied(conversationId: number, at: Date, input: Record<string, unknown> = DRAFT) {
  const [run] = await db.insert(actionRunSchema).values({
    orgId: ORG,
    actionId: 'gmail.send',
    input,
    status: 'rejected',
    invokedBy: 'agent:lead',
    decidedBy: 'usr-guard-dana',
    decidedAt: at,
    proposal: { origin: { conversationId, userId: 'usr-guard-dana' } } as never,
  }).returning({ id: actionRunSchema.id });
  return run!.id;
}

const ask = (conversationId: number, over: Partial<Parameters<typeof goalProposalRefusal>[0]> = {}) =>
  goalProposalRefusal({ orgId: ORG, conversationId, actionId: 'gmail.send', grant: 'send_email', actionInput: DRAFT, personAsked: false, ...over });

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-guard', name: 'Northwind', slug: 'northwind-guard' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-guard', slug: 'gtm-guard', name: 'GTM' });
});

describe('an import goal', () => {
  it('creates no draft-email action the person did not ask for', async () => {
    const id = await goalConversation();
    await said(id, 'user', new Date('2026-10-10T09:01:00Z'));

    const refusal = await ask(id);

    expect(refusal).toMatch(/nobody asked this goal for outreach/);
    expect(refusal).toMatch(/N items in the data room — open it\?/);
    expect(await db.select().from(actionRunSchema).where(eq(actionRunSchema.input, DRAFT as never))).toHaveLength(0);
  });

  it('still drafts one when the person told it to', async () => {
    const id = await goalConversation();
    await said(id, 'user', new Date('2026-10-10T09:01:00Z'));

    expect(await ask(id, { personAsked: true })).toBeNull();
  });

  it('holds nothing outside a running goal, and nothing that is not outreach', async () => {
    const paused = await goalConversation('stopped');
    const running = await goalConversation();

    expect(await ask(paused)).toBeNull();
    expect(await ask(running, { actionId: 'objects.propose_candidate', grant: 'propose_candidate', actionInput: { objectType: 'lead' } })).toBeNull();
  });
});

describe('deny means drop', () => {
  it('does not lead to a revised re-ask of the denied action', async () => {
    const id = await goalConversation();
    await said(id, 'user', new Date('2026-10-10T09:01:00Z'));
    const run = await denied(id, new Date('2026-10-10T09:05:00Z'));
    await said(id, 'decision', new Date('2026-10-10T09:05:00Z'), [{ type: 'decision_answer', answer: { kind: 'option', optionIds: ['reject'] } }]);

    // Reworded — a new subject line and body — to the same person: still the denied action.
    const refusal = await ask(id, { personAsked: true, actionInput: { ...DRAFT, subject: 'Your Northwind Expo materials', body: 'A shorter note.' } });

    expect(refusal).toMatch(/denied means dropped/);
    expect(refusal).toContain(String(run));
  });

  it('asks again once the person types new direction', async () => {
    const id = await goalConversation();
    await said(id, 'user', new Date('2026-10-10T09:01:00Z'));
    await denied(id, new Date('2026-10-10T09:05:00Z'));
    await said(id, 'user', new Date('2026-10-10T09:07:00Z'));

    expect(await ask(id, { personAsked: true })).toBeNull();
  });
});

describe('the rules, pure', () => {
  it('reads outreach off the grant, never the action id', () => {
    expect(isOutreachAction({ id: 'gmail.send', grant: 'send_email' })).toBe(true);
    expect(isOutreachAction({ id: 'anything.enroll', grant: 'enroll_lead' })).toBe(true);
    expect(isOutreachAction({ id: 'gmail.send' })).toBe(false);
    expect(outreachAllowed({ id: 'x', grant: 'send_email' }, false)).toBe(false);
    expect(outreachAllowed({ id: 'x', grant: 'send_email' }, true)).toBe(true);
  });

  it('a denial blocks the same action about the same subject until new direction', () => {
    const d = [{ id: 7, actionId: 'gmail.send', subject: subjectOf(DRAFT), decidedAt: new Date('2026-10-10T09:05:00Z') }];

    expect(deniedReAsk({ actionId: 'gmail.send', subject: subjectOf({ ...DRAFT, body: 'revised' }) }, d, new Date('2026-10-10T09:01:00Z'))?.id).toBe(7);
    expect(deniedReAsk({ actionId: 'gmail.send', subject: subjectOf({ to: 'lee@contoso.example' }) }, d, null)).toBeNull();
    expect(deniedReAsk({ actionId: 'gmail.send', subject: subjectOf(DRAFT) }, d, new Date('2026-10-10T09:06:00Z'))).toBeNull();
  });

  it('counts typed words and a card answered in their own words as direction, never Deny or Skip', () => {
    const at = (m: number) => new Date(`2026-10-10T09:0${m}:00Z`);

    expect(lastDirection([
      { role: 'decision', runs: [{ type: 'decision_answer', answer: { kind: 'option' } }], createdAt: at(5) },
      { role: 'decision', runs: [{ type: 'decision_answer', answer: { kind: 'skip' } }], createdAt: at(4) },
      { role: 'decision', runs: [{ type: 'decision_answer', answer: { kind: 'free_text' } }], createdAt: at(3) },
      { role: 'user', runs: null, createdAt: at(1) },
    ])).toEqual(at(3));
    expect(lastDirection([])).toBeNull();
  });
});
