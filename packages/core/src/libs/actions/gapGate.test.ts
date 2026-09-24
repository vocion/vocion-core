/**
 * The gate between "somebody asked for it" and "we are going to build it".
 *
 * Two of the first rows checked on the production board in September 2026 had
 * already shipped — one entirely, one half. Nobody had done anything wrong:
 * a request records what was true the day it was asked, and nothing re-read
 * it before work started. These are the promises that stop that reaching a
 * worker.
 */
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { gapRefusal } from './gapGate';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, autonomyPolicySchema, businessObjectSchema, businessObjectTypeSchema, trustRuleSchema } = await import('@/models/Schema');
const { forgetCachedObjectTypes } = await import('./objects-propose-candidate');
const { proposeAction } = await import('@/services/ActionService');

const NOW = new Date('2026-09-24T12:00:00Z');
const FRESH = { finding: 'add', how: 'send-api serves no /send route and has no mailer', checkedAt: '2026-09-24T09:00:00Z' };

describe('when the gate does not apply', () => {
  it('says nothing about a state that is not a commitment of anyone\'s time', () => {
    for (const state of ['new', 'triaged', 'out_of_scope', 'shipped', 'answered']) {
      expect(gapRefusal({}, { state }, NOW)).toBeUndefined();
    }
  });

  it('says nothing when the write is not a state change at all', () => {
    expect(gapRefusal({}, { priority: 80 }, NOW)).toBeUndefined();
  });
});

describe('what it refuses', () => {
  it('refuses planning a request nobody has re-checked', () => {
    const refusal = gapRefusal({}, { state: 'in_scope' }, NOW);

    expect(refusal).toMatch(/nobody has checked this is still missing/);
    expect(refusal).toMatch(/add \(none of it exists\), modify \(part of it already ships\) or none/);
  });

  it('refuses a finding that is not one of the three', () => {
    const check = { ...FRESH, finding: 'probably' };

    expect(gapRefusal({ gapCheck: check }, { state: 'in_scope' }, NOW)).toMatch(/is not one of add, modify or none/);
  });

  it('refuses work on something that already ships, and says to answer it instead', () => {
    const check = { finding: 'none', how: 'the appearance setting is in the account menu and on ⌘K', checkedAt: '2026-09-24T09:00:00Z' };
    const refusal = gapRefusal({ gapCheck: check }, { state: 'in_scope' }, NOW);

    expect(refusal).toMatch(/already ships/);
    expect(refusal).toMatch(/the appearance setting is in the account menu/);
    expect(refusal).toMatch(/Close it with an honest answer/);
  });

  it('refuses a half-true request, and says to narrow it rather than build it', () => {
    const check = { finding: 'modify', how: 'the Share dialog ships; no send route exists', checkedAt: '2026-09-24T09:00:00Z' };
    const refusal = gapRefusal({ gapCheck: check }, { state: 'in_scope' }, NOW);

    expect(refusal).toMatch(/part of this already ships/);
    expect(refusal).toMatch(/Narrow the request to the part that does not/);
  });

  it('refuses a check old enough to be about a different product', () => {
    const check = { ...FRESH, checkedAt: '2026-08-20T09:00:00Z' };

    expect(gapRefusal({ gapCheck: check }, { state: 'in_scope' }, NOW)).toMatch(/last checked 35 days ago/);
  });

  it('guards dispatch as well as planning, so a task cannot slip in past in_scope', () => {
    expect(gapRefusal({}, { state: 'building' }, NOW)).toMatch(/Not moved to building/);
  });
});

describe('what it lets through', () => {
  it('lets a fresh add through', () => {
    expect(gapRefusal({ gapCheck: FRESH }, { state: 'in_scope' }, NOW)).toBeUndefined();
  });

  it('reads the check being written in the same breath as the state', () => {
    // Triage records the finding and moves the state in one write; the gate
    // must see the value arriving, not only the one already stored.
    expect(gapRefusal({}, { state: 'in_scope', gapCheck: FRESH }, NOW)).toBeUndefined();
  });

  it('lets a check made fourteen days ago through, and stops at fifteen', () => {
    const at = (iso: string) => ({ gapCheck: { ...FRESH, checkedAt: iso } });

    expect(gapRefusal(at('2026-09-10T13:00:00Z'), { state: 'in_scope' }, NOW)).toBeUndefined();
    expect(gapRefusal(at('2026-09-09T11:00:00Z'), { state: 'in_scope' }, NOW)).toMatch(/last checked 15 days ago/);
  });
});

/**
 * THE WIRING, not the rule.
 *
 * A gate that computes the right answer and is never called is the bug this
 * repository shipped once already today — `stoppedShort()` classified a
 * stalled turn correctly and the browser's own route never asked it. So this
 * drives the refusal through `objects.update_meta`, the path a planner
 * actually takes, and proves the opposite too: a workspace whose type never
 * modelled the check is not subjected to it.
 */
const ORG = 'org_gap_gate';

const WITH_CHECK = {
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string' },
    state: { type: 'string', enum: ['new', 'triaged', 'in_scope'], title: 'State' },
    gapCheck: { type: 'object', properties: { finding: { type: 'string', enum: ['add', 'modify', 'none'] }, how: { type: 'string' }, checkedAt: { type: 'string', format: 'date-time' } } },
  },
};

const WITHOUT_CHECK = {
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string' },
    state: { type: 'string', enum: ['new', 'triaged', 'in_scope'], title: 'State' },
  },
};

let checkedId = 0;
let uncheckedId = 0;

function planner(): Principal {
  return { kind: 'agent', id: 'agent:task-planner', grants: ['update_object'], autonomy: 2, scope: { orgId: ORG } };
}

function plan(objectType: string, id: number, set: Record<string, unknown>) {
  return proposeAction({
    orgId: ORG,
    actionId: 'objects.update_meta',
    principal: planner(),
    invokedBy: 'agent:task-planner',
    input: { objectType, id, set, reason: 'Ranked into the twenty percent.' },
    proposal: { confidence: 0.9, rationale: 'test', suggestedDecision: 'approve', suggestedDecisionReason: 'top of the board' },
  });
}

async function seed(slug: string, schema: Record<string, unknown>): Promise<number> {
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug, label: slug, schema }).returning({ id: businessObjectTypeSchema.id });
  const [row] = await db.insert(businessObjectSchema).values({
    orgId: ORG,
    typeId: type!.id,
    title: 'A thing somebody asked for',
    status: 'active',
    metadata: { title: 'A thing somebody asked for', state: 'triaged' },
  }).returning({ id: businessObjectSchema.id });
  return row!.id;
}

describe('the gate, through the action a planner actually calls', () => {
  beforeEach(async () => {
    forgetCachedObjectTypes();
    await db.delete(actionRunSchema);
    await db.delete(businessObjectSchema);
    await db.delete(businessObjectTypeSchema);
    await db.delete(trustRuleSchema);
    await db.delete(autonomyPolicySchema);
    checkedId = await seed('request', WITH_CHECK);
    uncheckedId = await seed('errand', WITHOUT_CHECK);
  });

  afterAll(async () => {
    await db.delete(actionRunSchema);
    await db.delete(businessObjectSchema);
    await db.delete(businessObjectTypeSchema);
    await db.delete(trustRuleSchema);
    await db.delete(autonomyPolicySchema);
  });

  it('refuses to plan an unchecked request, and leaves no run behind', async () => {
    await expect(plan('request', checkedId, { state: 'in_scope' })).rejects.toThrow(/nobody has checked this is still missing/);

    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });

  it('lets the same write through once the check rides with it', async () => {
    const res = await plan('request', checkedId, {
      state: 'in_scope',
      gapCheck: { finding: 'add', how: 'send-api serves no /send route', checkedAt: new Date().toISOString() },
    });

    expect(res.status).toBe('done');
  });

  it('leaves a type that never modelled the check alone, because this action is domain-free', async () => {
    const res = await plan('errand', uncheckedId, { state: 'in_scope' });

    expect(res.status).toBe('done');
  });
});
