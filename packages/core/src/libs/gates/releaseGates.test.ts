/**
 * THE RELEASE'S DECLARED GATE: an announcement is for the people who use the
 * product. A drafted announcement closed "QA proved 6 of 6 criteria"
 * (2026-09-29); the release type's `announcement-in-plain-words` gate refuses
 * that where the record changes, with the reason, so the product manager
 * rewrites it. These run the YAML the plugin ships, as written.
 */
import type { Principal } from '@/services/authz';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { evaluateGates, gateRefusal } from '@/libs/gates/handoffGate';
import { loadPlugin } from '@/libs/workspace/plugins';
import { ANNOUNCEMENT_INTERNAL, plainAnnouncement } from '@/libs/workspace/releaseFeed';
import { HandoffGateSchema } from '@/libs/workspace/schemas';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { forgetCachedObjectTypes } = await import('@/libs/actions/objects-propose-candidate');
const { proposeAction } = await import('@/services/ActionService');

const TYPE = parse(readFileSync(join(loadPlugin('software-factory').sourcePath, 'objects/release/type.yaml'), 'utf8')) as {
  schema: Record<string, unknown>;
  gates: Parameters<typeof evaluateGates>[0];
};
const GATES = TYPE.gates;
const DRAFT = { notesSource: 'agent', announcementState: 'draft' };

function refusal(current: Record<string, unknown>, set: Record<string, unknown>): string | undefined {
  const f = evaluateGates(GATES, current, set);
  return f ? gateRefusal(f, 'Release') : undefined;
}

describe('announcement-in-plain-words', () => {
  it('is a gate the manifest grammar accepts, on every write of the announcement', () => {
    const gate = GATES.find(g => g.name === 'announcement-in-plain-words');

    expect(gate?.when).toEqual({ field: 'announcement', written: true });
    expect(HandoffGateSchema.safeParse(gate).success).toBe(true);
  });

  it('holds the same words the code strips', () => {
    const rule = GATES.flatMap(g => g.require).find(r => r.notMatches)!.notMatches!;

    expect(new RegExp(rule.pattern, rule.flags).source).toBe(ANNOUNCEMENT_INTERNAL.source);
    expect(rule.flags).toBe(ANNOUNCEMENT_INTERNAL.flags);
  });

  it('refuses a draft that carries QA counts, criteria, pull requests or plan risks, and says which words', () => {
    for (const internal of ['QA proved 6 of 6 criteria.', 'All criteria are met.', 'Proven by named tests.', 'Shipped in PR #114.', 'Both plan risks were handled.']) {
      const why = refusal({}, { ...DRAFT, announcement: `You can now download the viewers as a spreadsheet. ${internal}` });

      expect(why, internal).toMatch(/^Not written: the release fails the "announcement-in-plain-words" gate — announcement: it says "/);
      expect(why).toMatch(/rewrite it and write it again/);
    }
  });

  it('lets through what a person can now do, and leaves a person\'s own words alone', () => {
    expect(refusal({}, { ...DRAFT, announcement: 'You can now download everyone who opened a document as a spreadsheet. The free plan is unchanged.' })).toBeUndefined();
    expect(refusal({ notesSource: 'human' }, { announcement: 'QA signed this off today.' })).toBeUndefined();
    // A write that says nothing in the field is not this gate's business.
    expect(refusal({ announcement: 'QA proved 6 of 6 criteria.' }, { announcementState: 'draft' })).toBeUndefined();
  });

  it('takes the internal sentences out of a draft written before the gate', () => {
    expect(plainAnnouncement('You can now download a CSV of everyone who opened a document. The free plan is unchanged. QA proved 6 of 6 criteria.')).toEqual({
      text: 'You can now download a CSV of everyone who opened a document. The free plan is unchanged.',
      dropped: ['QA proved 6 of 6 criteria.'],
    });
  });
});

const ORG = 'org_release_gate';

function pm(): Principal {
  return { kind: 'agent', id: 'agent:product-manager', grants: ['update_object'], autonomy: 2, scope: { orgId: ORG } };
}

function write(id: number, set: Record<string, unknown>) {
  return proposeAction({
    orgId: ORG,
    actionId: 'objects.update_meta',
    principal: pm(),
    invokedBy: 'agent:product-manager',
    input: { objectType: 'release', id, set, reason: 'Drafted the announcement from the pack.' },
    proposal: { confidence: 0.9, rationale: 'test', suggestedDecision: 'approve', suggestedDecisionReason: 'draft' },
  });
}

describe('the gate, through the write the product manager actually makes', () => {
  let releaseId = 0;

  beforeEach(async () => {
    forgetCachedObjectTypes();
    await db.delete(actionRunSchema);
    await db.delete(businessObjectSchema);
    await db.delete(businessObjectTypeSchema);
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'release', label: 'Release', schema: { ...TYPE.schema, 'x-gates': GATES } }).returning({ id: businessObjectTypeSchema.id });
    const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'relay 8d8bab9', status: 'active', metadata: { product: 'relay' } }).returning({ id: businessObjectSchema.id });
    releaseId = row!.id;
  });

  afterAll(async () => {
    await db.delete(actionRunSchema);
    await db.delete(businessObjectSchema);
    await db.delete(businessObjectTypeSchema);
  });

  it('refuses the draft with its reason, writes nothing, and takes the rewrite', async () => {
    await expect(write(releaseId, { ...DRAFT, announcement: 'You can now export the viewers. QA proved 6 of 6 criteria.' })).rejects.toThrow(/it says "QA"/);

    const [held] = await db.select().from(businessObjectSchema).where((await import('drizzle-orm')).eq(businessObjectSchema.id, releaseId));

    expect((held!.metadata as Record<string, unknown>).announcement).toBeUndefined();

    const res = await write(releaseId, { ...DRAFT, announcement: 'You can now export everyone who opened a document as a spreadsheet.' });

    expect(res.status).toBe('done');
  });
});
