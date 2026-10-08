/**
 * "go" KEEPS THE THREAD (conversation 360, 2026-09-29).
 *
 * The person asked for a copy-link button, the PM filed request #224 and put
 * up two build cards; both ran on the trust bar (5016, 5018). The person said
 * "go". The replay told the second turn each card was "on the person's
 * screen" to decide — two undecided duplicates — and the recommend_action
 * tool's own row replayed one of them a second time. The PM tried to withdraw
 * #5016 (it had started the build) and then said it had no context.
 *
 * Now a card replays as ONE call, as what its proposal is when the history is
 * assembled: ran (and what it did), failed, turned down, or still waiting.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, actionRunSchema, projectMemberSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { historyMessages, outcomeOf, toolsMarker, withLiveCardState } = await import('./historyTools');

const ORG = 'org_live_cards';

// The stored turn, shaped like conversation 360's second assistant row.
const turn = {
  role: 'assistant' as const,
  id: 1001,
  content: 'Filed as request #224, and the build card is below.',
  runs: [
    { type: 'tool', name: 'recommend_action', input: { label: 'Start the build', action_id: 'factory.dispatch_task' }, output: '{"ok":false,"error":"action_input for factory.dispatch_task is invalid — requestId: Too small"}' },
    { type: 'tool', name: 'file_request', input: { title: 'Add a copy-link button' }, output: 'objects.propose_candidate is DONE: filed as request #224' },
    { type: 'tool', name: 'recommend_action', input: { label: 'Start the build — copy-link', action_id: 'factory.dispatch_task' }, output: 'Surfaced a one-tap recommendation to the user: "Start the build — copy-link".' },
    { type: 'card', label: 'Start the build — copy-link', actionId: 'factory.dispatch_task', input: { requestId: 224 }, runId: 5016, state: 'decided' },
  ],
};

function cardResults(messages: ReturnType<typeof historyMessages>): string[] {
  return messages.filter(m => m.role === 'tool' && m.name === 'recommend_action').map(m => (m as { content: string }).content);
}

afterAll(async () => {
  await db.delete(actionRunSchema);
});

describe('a card replays once, as what it became', () => {
  it('drops the tool\'s own "Surfaced" row beside the card it became, and keeps a refused call', () => {
    const calls = historyMessages(turn)[0] as { toolCalls: Array<{ name: string }> };

    expect(calls.toolCalls.map(c => c.name)).toEqual(['recommend_action', 'file_request', 'recommend_action']);
    expect(cardResults(historyMessages(turn))[0]).toMatch(/^Error: |"ok":false/);
  });

  it('a stored card that ran on the spot says it ran, and not to put it up, start it again or withdraw it', () => {
    const [, card] = cardResults(historyMessages(turn));

    expect(card).toMatch(/ran \(proposal #5016 executed\)/);
    expect(card).toMatch(/do not put it up again, start it a second time or withdraw it/);
    expect(card).not.toMatch(/on the person's screen/);
  });

  it('a card still waiting binds "go" to itself', () => {
    const waiting = { ...turn, runs: [{ type: 'card', label: 'Start the build', actionId: 'factory.dispatch_task', runId: 5015 }] };

    expect(cardResults(historyMessages(waiting))[0]).toMatch(/"go"/);
    expect(cardResults(historyMessages(waiting))[0]).toMatch(/decide_proposal 5015/);
  });

  it('says what a start did: planning first, or the build run it queued', () => {
    expect(outcomeOf({ planning: true, requestId: 224, why: 'the paths span 3 packages' })).toBe('it started request #224 by planning first (the paths span 3 packages); the build starts when the plan is approved');
    expect(outcomeOf({ workerRunId: 409, requestId: 130 })).toBe('it started build run #409 for request #130');
    expect(outcomeOf({ objectId: 224, objectType: 'request' })).toBe('it wrote request #224');
    expect(outcomeOf(null)).toBeUndefined();
  });
});

describe('withLiveCardState — the proposal as it stands when the history is assembled', () => {
  it('reads each card\'s run: a card stored "filed" that has since run replays as run, with what it did', async () => {
    const [done] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'factory.dispatch_task', input: { requestId: 224 }, status: 'done', result: { planning: true, requestId: 224, why: 'the paths span 3 packages' } }).returning({ id: actionRunSchema.id });
    const [failed] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'factory.dispatch_task', input: { requestId: 224 }, status: 'failed', error: `already building: run #${done!.id}` }).returning({ id: actionRunSchema.id });
    const stored = [
      { role: 'user' as const, content: 'Add a copy-link button.' },
      { ...turn, runs: [
        { type: 'card', label: 'Start the build', actionId: 'factory.dispatch_task', runId: done!.id, state: 'filed' },
        { type: 'card', label: 'Approve build', actionId: 'factory.dispatch_task', runId: failed!.id, state: 'filed' },
      ] },
    ];

    const live = await withLiveCardState(ORG, stored);
    const results = cardResults(historyMessages(live![1]!));

    expect(results[0]).toMatch(new RegExp(`ran \\(proposal #${done!.id} executed\\): it started request #224 by planning first`));
    expect(results[1]).toMatch(/was approved and failed .*already building/);
    expect(toolsMarker(live![1]!.runs)).toMatch(/ran: it started request #224/);
  });

  it('leaves a history with no cards, or another workspace\'s runs, as it was', async () => {
    const plain = [{ role: 'assistant' as const, content: 'Hello.' }];

    expect(await withLiveCardState(ORG, plain)).toBe(plain);

    const [other] = await db.insert(actionRunSchema).values({ orgId: 'org_else', actionId: 'factory.dispatch_task', input: {}, status: 'done' }).returning({ id: actionRunSchema.id });
    const stored = [{ ...turn, runs: [{ type: 'card', label: 'X', actionId: 'factory.dispatch_task', runId: other!.id }] }];
    const live = await withLiveCardState(ORG, stored);

    expect((live![0]!.runs as Array<{ status?: string }>)[0]!.status).toBeUndefined();
  });
});

/**
 * A card the person's assistant brought back from a workspace it asked lives
 * THERE (`workspace` on the card). The replay reads it there, as the person,
 * only while they can still act in that workspace; one they can no longer
 * reach is dropped, never read under the asking thread's workspace.
 */
describe('withLiveCardState — a card whose run lives in another workspace', () => {
  const NORTHWIND = 'acct-live-cards';
  const ALEX = 'usr-live-cards-alex';
  const REVENUE = 'proj-live-cards-revenue'; // Alex holds a grant
  const DELIVERY = 'proj-live-cards-delivery'; // Alex holds none

  async function seed() {
    process.env.VOCION_ENFORCE_WORKSPACE_ACCESS = '1';
    await db.insert(tenantAccountSchema).values({ id: NORTHWIND, name: 'Northwind', slug: 'northwind-live-cards' });
    await db.insert(userSchema).values({ id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera' });
    await db.insert(accountMembershipSchema).values({ accountId: NORTHWIND, userId: ALEX, role: 'member' });
    await db.insert(projectSchema).values([
      { id: REVENUE, accountId: NORTHWIND, slug: 'revenue', name: 'Northwind Revenue' },
      { id: DELIVERY, accountId: NORTHWIND, slug: 'delivery', name: 'Delivery' },
    ]);
    await db.insert(projectMemberSchema).values({ projectId: REVENUE, userId: ALEX, role: 'member' });
  }

  afterEach(async () => {
    delete process.env.VOCION_ENFORCE_WORKSPACE_ACCESS;
    await db.delete(actionRunSchema);
    await db.delete(projectMemberSchema);
    await db.delete(projectSchema);
    await db.delete(accountMembershipSchema);
    await db.delete(userSchema);
    await db.delete(tenantAccountSchema);
  });

  const revenue = { id: REVENUE, slug: 'revenue', name: 'Northwind Revenue' };
  const delivery = { id: DELIVERY, slug: 'delivery', name: 'Delivery' };

  it('reads the run in its own workspace: a card stored "filed" that was approved there replays as run', async () => {
    await seed();
    const [done] = await db.insert(actionRunSchema).values({ orgId: REVENUE, actionId: 'email.send', input: {}, status: 'done', result: { objectId: 88, objectType: 'follow_up' } }).returning({ id: actionRunSchema.id });
    const stored = [{ ...turn, runs: [{ type: 'card', label: 'Send Contoso the order form', actionId: 'email.send', runId: done!.id, state: 'filed', workspace: revenue }] }];

    const live = await withLiveCardState(ORG, stored, ALEX);
    const [result] = cardResults(historyMessages(live![0]!));

    expect((live![0]!.runs as Array<{ status?: string }>)[0]!.status).toBe('done');
    expect(result).toMatch(new RegExp(`ran \\(proposal #${done!.id} in Northwind Revenue executed\\): it wrote follow up #88`));
  });

  it('a card still waiting there points "go" at the card, never at a decide call from here', async () => {
    await seed();
    const [waiting] = await db.insert(actionRunSchema).values({ orgId: REVENUE, actionId: 'email.send', input: {}, status: 'pending' }).returning({ id: actionRunSchema.id });
    const stored = [{ ...turn, runs: [{ type: 'card', label: 'Send Contoso the order form', actionId: 'email.send', runId: waiting!.id, state: 'filed', workspace: revenue }] }];

    const [result] = cardResults(historyMessages((await withLiveCardState(ORG, stored, ALEX))![0]!));

    expect(result).toContain(`proposal #${waiting!.id} in Northwind Revenue, waiting on the person`);
    expect(result).toContain('press it on the card');
    expect(result).not.toContain('decide_proposal');
  });

  it('drops a card in a workspace the person can no longer reach, and every other workspace\'s card when no person is named', async () => {
    await seed();
    const [granted] = await db.insert(actionRunSchema).values({ orgId: REVENUE, actionId: 'email.send', input: {}, status: 'done' }).returning({ id: actionRunSchema.id });
    const [ungranted] = await db.insert(actionRunSchema).values({ orgId: DELIVERY, actionId: 'email.send', input: {}, status: 'done' }).returning({ id: actionRunSchema.id });
    const [here] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'factory.dispatch_task', input: {}, status: 'failed', error: 'no worker' }).returning({ id: actionRunSchema.id });
    const stored = [{ ...turn, runs: [
      { type: 'card', label: 'Revenue card', actionId: 'email.send', runId: granted!.id, workspace: revenue },
      { type: 'card', label: 'Delivery card', actionId: 'email.send', runId: ungranted!.id, workspace: delivery },
      { type: 'card', label: 'Here card', actionId: 'factory.dispatch_task', runId: here!.id },
    ] }];

    const asAlex = (await withLiveCardState(ORG, stored, ALEX))![0]!.runs as Array<{ label: string; status?: string }>;

    expect(asAlex.map(r => [r.label, r.status])).toEqual([['Revenue card', 'done'], ['Here card', 'failed']]);

    const asNobody = (await withLiveCardState(ORG, stored))![0]!.runs as Array<{ label: string; status?: string }>;

    expect(asNobody.map(r => [r.label, r.status])).toEqual([['Here card', 'failed']]);
  });
});
