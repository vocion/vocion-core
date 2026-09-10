import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * ActionService gating against PGlite. Uses a registered test action (no creds,
 * no network) so the test isolates the propose→gate→execute logic + the
 * autonomy gate. Gmail specifics are covered in gmail-send.test.ts.
 */
import { z } from 'zod';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { proposeAction, executeAction, rejectAction } = await import('@/services/ActionService');
const { eq } = await import('drizzle-orm');

// Register a side-effect-free external action for the test.
let executed = 0;
registerAction({
  id: 'test.write',
  name: 'Test write',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  execute: async (_ctx, input) => {
    executed += 1;
    return { echoed: (input as { value: string }).value };
  },
});

// A second action whose schema carries a hand-authored `superRefine` message
// (the same shape `objects.propose_candidate` uses for its `dedupOn` checks),
// so the ZodError-to-ActionError translation can be tested against a message
// that isn't zod's own generic wording.
registerAction({
  id: 'test.write-custom-message',
  name: 'Test write with a custom validation message',
  description: 'test',
  inputSchema: z.object({ value: z.string() }).superRefine((value, ctx) => {
    if (value.value === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'value must not be empty' });
    }
  }),
  grant: 'test_write',
  external: true,
  execute: async (_ctx, input) => ({ echoed: (input as { value: string }).value }),
});

const ORG = 'org_act';
function agent(autonomy: 1 | 2 | 3 | 4 | 5): Principal {
  return { kind: 'agent', id: 'agent:follow-up', grants: ['test_write'], autonomy, scope: { orgId: ORG } };
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  executed = 0;
});

afterAll(async () => {
  await db.delete(actionRunSchema);
});

describe('ActionService gating', () => {
  it('gates an external action from a low-autonomy agent → pending, not executed', async () => {
    const out = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'x' }, principal: agent(2) });

    expect(out.status).toBe('pending');
    expect(executed).toBe(0);

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, out.runId));

    expect(row!.status).toBe('pending');
  });

  it('executes immediately for a high-autonomy agent', async () => {
    const out = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'go' }, principal: agent(4) });

    expect(out.status).toBe('done');
    expect(out.result).toMatchObject({ echoed: 'go' });
    expect(executed).toBe(1);
  });

  it('forbids an agent without the grant', async () => {
    const noGrant: Principal = { kind: 'agent', id: 'agent:x', grants: [], autonomy: 5, scope: { orgId: ORG } };

    await expect(proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'x' }, principal: noGrant }))
      .rejects
      .toMatchObject({ code: 'FORBIDDEN' });
  });

  it('executeAction runs a pending action on approval', async () => {
    const out = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'later' }, principal: agent(1) });

    expect(out.status).toBe('pending');

    const done = await executeAction(out.runId, ORG);

    expect(done.status).toBe('done');
    expect(executed).toBe(1);
  });

  it('stamps who decided and when, on approve and on reject', async () => {
    const approved = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'a' }, principal: agent(1) });
    await executeAction(approved.runId, ORG, { reviewedBy: 'user-jamie' });
    const [runA] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, approved.runId));

    expect(runA).toMatchObject({ status: 'done', decidedBy: 'user-jamie' });
    expect(runA!.decidedAt).toBeInstanceOf(Date);

    const rejected = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'b' }, principal: agent(1) });
    await rejectAction(rejected.runId, ORG, 'wrong angle', { reviewedBy: 'user-lili' });
    const [runR] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, rejected.runId));

    expect(runR).toMatchObject({ status: 'rejected', decidedBy: 'user-lili' });
    expect(runR!.decidedAt).toBeInstanceOf(Date);
  });

  it('a machine execution with no reviewer stamps no decision', async () => {
    const out = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'auto' }, principal: agent(5) });
    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, out.runId));

    expect(out.status).toBe('done');
    expect(run!.decidedBy).toBeNull();
    expect(run!.decidedAt).toBeNull();
  });

  it('validates input against the action schema', async () => {
    await expect(proposeAction({ orgId: ORG, actionId: 'test.write', input: { wrong: 1 }, principal: agent(5) }))
      .rejects
      .toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('surfaces a schema violation as a clean ActionError, not a raw ZodError dump', async () => {
    // Before this fix, `proposeAction` let `inputSchema.parse` throw straight
    // through: every caller (the agent's `propose_action` tool, the write
    // API, the review router) only reads `.message` off whatever it catches,
    // and a raw ZodError's `.message` is its issues array JSON-stringified —
    // burying a hand-authored validation message inside brace-and-quote
    // noise instead of handing back the sentence it was written to be.
    let caught: unknown;
    try {
      await proposeAction({ orgId: ORG, actionId: 'test.write-custom-message', input: { value: '' }, principal: agent(5) });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'VALIDATION_FAILED', message: 'value must not be empty' });
    // The regression this guards against: message text buried in a JSON blob.
    expect((caught as Error).message).not.toMatch(/[[{]/);
  });
});

let candidatesExecuted = 0;

// Actions that keep a moderated record per proposal — an extracted candidate a
// human approves or rejects. Re-proposing one a moderator already decided must
// not put a second card in front of them (VEERIO-262).
registerAction({
  id: 'test.candidate',
  name: 'Test candidate',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  dedupKeyFor: input => `test.candidate:${(input as { value: string }).value}`,
  dedupAgainstDecided: {},
  execute: async (_ctx, input) => {
    candidatesExecuted += 1;
    return { echoed: (input as { value: string }).value };
  },
});

// Same shape, but the tenant wants a rejection to be re-proposable: only a
// completed run blocks a fresh card.
registerAction({
  id: 'test.candidate-done-only',
  name: 'Test candidate, done blocks only',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  dedupKeyFor: input => `test.candidate-done-only:${(input as { value: string }).value}`,
  dedupAgainstDecided: { statuses: ['done'] },
  execute: async (_ctx, input) => ({ echoed: (input as { value: string }).value }),
});

// Same shape, but a decision goes stale: after a week the candidate may be
// proposed again.
registerAction({
  id: 'test.candidate-weekly',
  name: 'Test candidate, weekly re-proposal',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  dedupKeyFor: input => `test.candidate-weekly:${(input as { value: string }).value}`,
  dedupAgainstDecided: { reproposeAfterDays: 7 },
  execute: async (_ctx, input) => ({ echoed: (input as { value: string }).value }),
});

describe('proposing against an already-decided run', () => {
  beforeEach(() => {
    candidatesExecuted = 0;
  });

  it('names the outcome when there was nothing to collapse into', async () => {
    const out = await proposeAction({ orgId: ORG, actionId: 'test.candidate', input: { value: 'open-mic' }, principal: agent(2) });

    expect(out.outcome).toBe('created');
    expect(out.status).toBe('pending');
  });

  it('names a refresh of a pending run as a refresh, not a create', async () => {
    const first = await proposeAction({ orgId: ORG, actionId: 'test.candidate', input: { value: 'open-mic' }, principal: agent(2) });
    const second = await proposeAction({ orgId: ORG, actionId: 'test.candidate', input: { value: 'open-mic' }, principal: agent(2) });

    // Same row, and the caller can tell — before this, both answered
    // `{ runId, status: 'pending' }` and no consumer could distinguish them.
    expect(second.runId).toBe(first.runId);
    expect(second.outcome).toBe('refreshed');
    expect(await db.select().from(actionRunSchema)).toHaveLength(1);
  });

  it('creates no second card for a candidate a moderator already rejected', async () => {
    const first = await proposeAction({ orgId: ORG, actionId: 'test.candidate', input: { value: 'open-mic' }, principal: agent(2) });
    await rejectAction(first.runId, ORG, 'not for us', { reviewedBy: 'user-lili' });

    const again = await proposeAction({ orgId: ORG, actionId: 'test.candidate', input: { value: 'open-mic' }, principal: agent(2) });

    expect(again.outcome).toBe('already_decided');
    expect(again.runId).toBe(first.runId);
    expect(again.status).toBe('rejected');
    expect(again.decidedAt).toBeInstanceOf(Date);
    // The whole point: the reviewer's queue does not grow back.
    expect(await db.select().from(actionRunSchema)).toHaveLength(1);
  });

  it('creates no second card for a candidate already approved and run', async () => {
    const first = await proposeAction({ orgId: ORG, actionId: 'test.candidate', input: { value: 'open-mic' }, principal: agent(2) });
    await executeAction(first.runId, ORG, { reviewedBy: 'user-jamie' });

    const again = await proposeAction({ orgId: ORG, actionId: 'test.candidate', input: { value: 'open-mic' }, principal: agent(2) });

    expect(again.outcome).toBe('already_decided');
    expect(again.runId).toBe(first.runId);
    expect(again.status).toBe('done');
    expect(await db.select().from(actionRunSchema)).toHaveLength(1);
  });

  it('runs the action once, not twice, when the decided run is re-proposed', async () => {
    const first = await proposeAction({ orgId: ORG, actionId: 'test.candidate', input: { value: 'open-mic' }, principal: agent(2) });
    await executeAction(first.runId, ORG, { reviewedBy: 'user-jamie' });

    await proposeAction({ orgId: ORG, actionId: 'test.candidate', input: { value: 'open-mic' }, principal: agent(2) });

    expect(candidatesExecuted).toBe(1);
  });

  it('leaves an action that never opted in free to be proposed again after a decision', async () => {
    // `gmail.send` keys on the recipient. Blocking decided runs by default
    // would mean one sent email bars that address forever.
    const first = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'x' }, principal: agent(2), dedupKey: 'test.write:someone' });
    await rejectAction(first.runId, ORG, 'no', { reviewedBy: 'user-lili' });

    const again = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'x' }, principal: agent(2), dedupKey: 'test.write:someone' });

    expect(again.outcome).toBe('created');
    expect(again.runId).not.toBe(first.runId);
    expect(await db.select().from(actionRunSchema)).toHaveLength(2);
  });

  it('honours an action that blocks on done but lets a rejection be re-proposed', async () => {
    const first = await proposeAction({ orgId: ORG, actionId: 'test.candidate-done-only', input: { value: 'open-mic' }, principal: agent(2) });
    await rejectAction(first.runId, ORG, 'not this week', { reviewedBy: 'user-lili' });

    const again = await proposeAction({ orgId: ORG, actionId: 'test.candidate-done-only', input: { value: 'open-mic' }, principal: agent(2) });

    expect(again.outcome).toBe('created');
    expect(again.runId).not.toBe(first.runId);
  });

  it('lets a decision go stale when the action sets a re-proposal window', async () => {
    const first = await proposeAction({ orgId: ORG, actionId: 'test.candidate-weekly', input: { value: 'open-mic' }, principal: agent(2) });
    await rejectAction(first.runId, ORG, 'too early', { reviewedBy: 'user-lili' });

    const withinWindow = await proposeAction({ orgId: ORG, actionId: 'test.candidate-weekly', input: { value: 'open-mic' }, principal: agent(2) });

    expect(withinWindow.outcome).toBe('already_decided');

    // Age the decision past the window.
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
    await db.update(actionRunSchema).set({ decidedAt: eightDaysAgo }).where(eq(actionRunSchema.id, first.runId));

    const afterWindow = await proposeAction({ orgId: ORG, actionId: 'test.candidate-weekly', input: { value: 'open-mic' }, principal: agent(2) });

    expect(afterWindow.outcome).toBe('created');
    expect(afterWindow.runId).not.toBe(first.runId);
  });

  it('keeps two different actions apart when a caller reuses one dedup key', async () => {
    // `POST /api/v1/reviews/propose` lets a caller pass any `dedupKey`, so
    // two actions can end up sharing one — `listing-42` for both. Matching on
    // the key alone would let one action's pending row be rewritten with the
    // other's input, and its `onProposed` run against a row it does not own.
    const other = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'other' }, principal: agent(2), dedupKey: 'shared-key' });

    const candidate = await proposeAction({ orgId: ORG, actionId: 'test.candidate', input: { value: 'mine' }, principal: agent(2), dedupKey: 'shared-key' });

    expect(candidate.outcome).toBe('created');
    expect(candidate.runId).not.toBe(other.runId);

    const [otherRow] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, other.runId));

    expect(otherRow!.input).toMatchObject({ value: 'other' });
  });

  it('does not let another action\'s decided run block this one', async () => {
    const other = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'other' }, principal: agent(2), dedupKey: 'shared-key' });
    await rejectAction(other.runId, ORG, 'no', { reviewedBy: 'user-lili' });

    const candidate = await proposeAction({ orgId: ORG, actionId: 'test.candidate', input: { value: 'mine' }, principal: agent(2), dedupKey: 'shared-key' });

    // Handing back the other action's run id here would drop this proposal
    // for good and tell the caller about a decision on something else.
    expect(candidate.outcome).toBe('created');
    expect(candidate.runId).not.toBe(other.runId);
  });

  it('prefers the pending row when one is still open alongside a decided one', async () => {
    const decided = await proposeAction({ orgId: ORG, actionId: 'test.candidate', input: { value: 'open-mic' }, principal: agent(2) });
    await rejectAction(decided.runId, ORG, 'no', { reviewedBy: 'user-lili' });
    // A row that predates the opt-in, or one an admin re-opened: whatever put
    // it there, a card a moderator can still act on is the one to refresh.
    const [reopened] = await db
      .insert(actionRunSchema)
      .values({ orgId: ORG, actionId: 'test.candidate', input: { value: 'open-mic' }, status: 'pending', dedupKey: 'test.candidate:open-mic' })
      .returning({ id: actionRunSchema.id });

    const again = await proposeAction({ orgId: ORG, actionId: 'test.candidate', input: { value: 'open-mic' }, principal: agent(2) });

    expect(again.outcome).toBe('refreshed');
    expect(again.runId).toBe(reopened!.id);
  });
});
