/**
 * THE REQUEST'S DECLARED GATES (backlog 011).
 *
 * `still-missing`, `contract-met` and `shown` were TypeScript (gapGate.ts,
 * doneGate.ts) until 2026-09-25; they are lines in the request type's
 * `gates:` now, and these are the same cases run against the YAML the plugin
 * ships — so a change to the wording or the thresholds is a change to the
 * manifest, and this file says whether the refusals still fire.
 */
import type { Principal } from '@/services/authz';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { evaluateGates, gateRefusal } from '@/libs/gates/handoffGate';
import { loadPlugin } from '@/libs/workspace/plugins';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, autonomyPolicySchema, businessObjectSchema, businessObjectTypeSchema, trustRuleSchema } = await import('@/models/Schema');
const { forgetCachedObjectTypes } = await import('@/libs/actions/objects-propose-candidate');
const { proposeAction } = await import('@/services/ActionService');

const NOW = new Date('2026-09-24T12:00:00Z');
// The YAML the plugin ships, as written — the manifest under test.
const GATES = (parse(readFileSync(join(loadPlugin('software-factory').sourcePath, 'objects/request/type.yaml'), 'utf8')) as { gates: Parameters<typeof evaluateGates>[0] }).gates;

function refusal(current: Record<string, unknown>, set: Record<string, unknown>): string | undefined {
  const f = evaluateGates(GATES.filter(g => ['still-missing', 'contract-met', 'shown'].includes(g.name)), current, set, NOW);
  return f ? gateRefusal(f, 'Request') : undefined;
}

describe('still-missing — nobody plans a request without checking it is still missing', () => {
  const FRESH = { finding: 'add', how: 'send-api serves no /send route', checkedAt: '2026-09-23T12:00:00Z' };

  it('says nothing about a state that is not a commitment of anyone\'s time, or about a write that moves no state', () => {
    for (const state of ['new', 'triaged', 'out_of_scope', 'deferred']) {
      expect(refusal({}, { state })).toBeUndefined();
    }

    expect(refusal({}, { priority: 80 })).toBeUndefined();
  });

  it('refuses planning a request nobody has re-checked, and guards dispatch the same way', () => {
    expect(refusal({}, { state: 'in_scope' })).toMatch(/nobody has checked this is still missing/);
    expect(refusal({}, { state: 'in_scope' })).toMatch(/add \(none of it exists\), modify \(part of it already ships\) or none/);
    expect(refusal({}, { state: 'building' })).toMatch(/Not moved to building/);
  });

  it('refuses a finding that is not one of the three', () => {
    expect(refusal({ gapCheck: { ...FRESH, finding: 'maybe' } }, { state: 'in_scope' })).toMatch(/is not one of add, modify or none/);
  });

  it('refuses work on something that already ships, and says to answer it instead', () => {
    const out = refusal({ gapCheck: { ...FRESH, finding: 'none', how: 'the appearance setting is in the account menu' } }, { state: 'in_scope' });

    expect(out).toMatch(/already ships/);
    expect(out).toMatch(/Close it with an honest answer/);
  });

  it('refuses a half-true request, and says to narrow it rather than build it', () => {
    const out = refusal({ gapCheck: { ...FRESH, finding: 'modify' } }, { state: 'in_scope' });

    expect(out).toMatch(/part of this already ships/);
    expect(out).toMatch(/Narrow the request to the part that does not/);
  });

  it('refuses a check old enough to be about a different product: fourteen days pass, fifteen do not', () => {
    expect(refusal({ gapCheck: { ...FRESH, checkedAt: '2026-08-20T12:00:00Z' } }, { state: 'in_scope' })).toMatch(/last checked 35 days ago/);
    expect(refusal({ gapCheck: { ...FRESH, checkedAt: '2026-09-10T13:00:00Z' } }, { state: 'in_scope' })).toBeUndefined();
    expect(refusal({ gapCheck: { ...FRESH, checkedAt: '2026-09-09T11:00:00Z' } }, { state: 'in_scope' })).toMatch(/last checked 15 days ago/);
  });

  it('lets a fresh add through, including one written in the same breath as the state', () => {
    expect(refusal({ gapCheck: FRESH }, { state: 'in_scope' })).toBeUndefined();
    expect(refusal({}, { state: 'in_scope', gapCheck: FRESH })).toBeUndefined();
  });
});

describe('contract-met and shown — a request is not done while its contract is unmet or unseen', () => {
  it('lets a write through that is not a move into a done state', () => {
    expect(refusal({}, { priority: 80 })).toBeUndefined();
  });

  it('refuses done while an acceptance criterion is unmet, and names it; unchecked is unmet', () => {
    const out = refusal({ acceptance: [{ statement: 'Every screen shows Stamp', met: false }, { statement: 'Sign-in works', met: true }] }, { state: 'shipped' });

    expect(out).toMatch(/1 of 2 acceptance criteria are not met/);
    expect(out).toMatch(/Every screen shows Stamp/);
    expect(refusal({ acceptance: [{ statement: 'a' }] }, { state: 'accepted' })).toMatch(/not met/);
  });

  it('lets it through once every criterion is met', () => {
    expect(refusal({ acceptance: [{ statement: 'a', met: true }, { statement: 'b', met: true }] }, { state: 'shipped' })).toBeUndefined();
  });

  it('refuses a visible change that nobody has looked at', () => {
    expect(refusal({ surface: 'ui' }, { state: 'shipped' })).toMatch(/nothing shows what it looks like now/);
    expect(refusal({ surface: 'flow' }, { state: 'shipped' })).toMatch(/after-shot/);
  });

  it('accepts a recorded reason for having no visual, or an after-shot', () => {
    expect(refusal({ surface: 'ui', visuals: { noVisualReason: 'a background job' } }, { state: 'shipped' })).toBeUndefined();
    expect(refusal({ surface: 'ui', visuals: { afterArtifactIds: [91] } }, { state: 'shipped' })).toBeUndefined();
  });

  it('asks nothing visual of an answered question, or of work with no visible surface', () => {
    expect(refusal({ surface: 'ui' }, { state: 'answered' })).toBeUndefined();
    expect(refusal({ surface: 'infra' }, { state: 'shipped' })).toBeUndefined();
  });
});

const ORG = 'org_gap_gate';

const WITH_CHECK = {
  'type': 'object',
  // The gates ride inside the stored schema, where the applier puts them (`x-gates`).
  'x-gates': GATES.filter(g => g.name === 'still-missing'),
  'required': ['title'],
  'properties': {
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

describe('the declared gate, through the action a planner actually calls', () => {
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
