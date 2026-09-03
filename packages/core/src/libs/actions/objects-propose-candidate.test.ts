/**
 * objects.propose_candidate — the promises the ingestion loop rests on:
 * one queue item per candidate (not per page, not per scrape), a real
 * business object from the moment it is extracted, a card built from the
 * workspace's own object type, and an approve that publishes nothing.
 *
 * The fixtures use a scraped-event shape on purpose: it is the first real
 * caller, and every event-specific word here lives in the test's object type
 * definition, never in the action.
 */
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, businessObjectSchema, businessObjectTypeSchema, trustRuleSchema } = await import('@/models/Schema');
const { objectProposeCandidateAction } = await import('./objects-propose-candidate');
const { listActions } = await import('./registry');
const { proposeAction, executeAction, rejectAction } = await import('@/services/ActionService');
const { and, eq } = await import('drizzle-orm');

const ORG = 'org_candidates';
const OTHER_ORG = 'org_someone_else';
const TYPE_SLUG = 'event_candidate';

/** What a workspace's `objects/event-candidate.yaml` applies into the registry. */
const EVENT_CANDIDATE_SCHEMA = {
  type: 'object',
  required: ['title', 'start'],
  // Card order. Needed because jsonb does not preserve the key order below.
  propertyOrder: ['title', 'start', 'venue', 'categories'],
  properties: {
    title: { type: 'string', title: 'Event' },
    start: { type: 'string', title: 'Starts' },
    venue: { type: 'string', title: 'Venue' },
    categories: { type: 'array', items: { type: 'string' }, title: 'Categories' },
  },
};

/**
 * Autonomy 2 → an external action is gated into the review queue.
 * @param orgId
 */
function ingestionAgent(orgId = ORG): Principal {
  return { kind: 'agent', id: 'agent:ingestion-lead', grants: ['propose_candidate'], autonomy: 2, scope: { orgId } };
}

function candidate(over: Record<string, unknown> = {}) {
  return {
    objectType: TYPE_SLUG,
    title: 'Open Mic Night',
    fields: {
      title: 'Open Mic Night',
      start: '2026-09-12T19:30',
      venue: 'The Flynn',
      categories: ['Music'],
    },
    dedupOn: ['title', 'start', 'venue'],
    sourceUrl: 'https://listings.example.org/events/open-mic-night',
    sourceListingUrl: 'https://listings.example.org/events',
    summary: 'Sign-ups at 7, music at 7:30.',
    ...over,
  };
}

function parse(over: Record<string, unknown> = {}) {
  return objectProposeCandidateAction.inputSchema.parse(candidate(over));
}

function dedupKey(over: Record<string, unknown> = {}): string | undefined {
  return objectProposeCandidateAction.dedupKeyFor!(parse(over));
}

function fieldValue(fields: Array<{ label: string; value: string; href?: string }>, label: string) {
  return fields.find(field => field.label === label);
}

/**
 * Applies the object type the way a workspace apply would, for one org.
 * @param orgId
 * @param schema
 */
async function seedObjectType(orgId = ORG, schema: Record<string, unknown> | null = EVENT_CANDIDATE_SCHEMA) {
  await db.insert(businessObjectTypeSchema).values({
    orgId,
    slug: TYPE_SLUG,
    label: 'Event candidate',
    schema: schema ?? undefined,
  });
}

async function objectsFor(orgId = ORG) {
  return db.select().from(businessObjectSchema).where(eq(businessObjectSchema.orgId, orgId));
}

beforeEach(async () => {
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
  await seedObjectType();
});

afterAll(async () => {
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
});

describe('the input contract — domain-free', () => {
  it('takes any object type and any payload, so a new domain needs no code here', () => {
    const parsed = objectProposeCandidateAction.inputSchema.parse({
      objectType: 'grant-deadline',
      title: 'NEA Folk Arts, round 2',
      fields: { closesOn: '2026-11-01', amountUsd: 25000 },
      dedupOn: ['closesOn'],
    });

    expect(parsed.objectType).toBe('grant-deadline');
    expect(parsed.fields).toEqual({ closesOn: '2026-11-01', amountUsd: 25000 });
  });

  it('defaults the collections so nothing downstream has to guard them', () => {
    const parsed = objectProposeCandidateAction.inputSchema.parse({ objectType: 'x', title: 'y' });

    expect(parsed.fields).toEqual({});
    expect(parsed.dedupOn).toEqual([]);
  });

  it('rejects a source link that is not a URL', () => {
    expect(() => parse({ sourceUrl: 'listings.example.org/events' })).toThrow();
  });
});

describe('the dedup key — per candidate, never per page', () => {
  it('is built from the named fields, in the order they are named', () => {
    expect(dedupKey()).toBe('objects.propose_candidate:event-candidate|open-mic-night|2026-09-12t19-30|the-flynn');
  });

  it('collapses casing, punctuation and accents so two extractions are one item', () => {
    const a = dedupKey();
    const b = dedupKey({ fields: { title: '  OPEN mic  Night! ', start: '2026-09-12T19:30', venue: 'The Flynn.' } });

    expect(b).toBe(a);
    expect(dedupKey({ fields: { title: 'Soirée', start: '2026-09-12T19:30', venue: 'Café' } }))
      .toBe('objects.propose_candidate:event-candidate|soiree|2026-09-12t19-30|cafe');
  });

  it('changes when an identity field changes, and not when anything else does', () => {
    const a = dedupKey();

    expect(dedupKey({ fields: { title: 'Open Mic Night', start: '2026-09-19T19:30', venue: 'The Flynn' } })).not.toBe(a);
    // A corrected blurb and new categories are the same candidate.
    expect(dedupKey({
      summary: 'Rewritten blurb.',
      fields: { title: 'Open Mic Night', start: '2026-09-12T19:30', venue: 'The Flynn', categories: ['Music', 'Free'] },
    })).toBe(a);
  });

  it('holds a slot for an identity field the extractor left empty', () => {
    // Without the placeholder, a missing venue would silently merge two
    // different candidates into one queue item.
    expect(dedupKey({ fields: { title: 'Open Mic Night', start: '2026-09-12T19:30' } }))
      .toBe('objects.propose_candidate:event-candidate|open-mic-night|2026-09-12t19-30|none');
  });

  it('has no key at all when nothing identifies the candidate', () => {
    // The dangerous alternative is a constant key: every candidate of the type
    // would collapse into one queue item and the reviewer would see only the
    // last one to arrive.
    expect(objectProposeCandidateAction.dedupKeyFor!(parse({ dedupOn: [] }))).toBeUndefined();
  });

  it('separates object types that happen to share a title', () => {
    expect(dedupKey({ objectType: 'workshop_candidate' })).not.toBe(dedupKey());
  });

  it('never keys on the page, so two candidates off one listing are two items', () => {
    const first = dedupKey();

    expect(first).not.toContain('listings.example.org');
    expect(dedupKey({ fields: { title: 'Poetry Slam', start: '2026-09-12T19:30', venue: 'The Flynn' } })).not.toBe(first);
  });
});

describe('the candidate row', () => {
  it('exists from the moment it is proposed, holding the payload and linked to nothing outside', async () => {
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate(),
    });

    const [object] = await objectsFor();

    expect(object).toBeDefined();
    expect(object!.status).toBe('candidate');
    expect(object!.title).toBe('Open Mic Night');
    expect(object!.reviewActionRunId).toBe(proposed.runId);
    expect(object!.metadata).toMatchObject({ start: '2026-09-12T19:30', venue: 'The Flynn' });
    // Nothing has been published, so there is nothing to point at.
    expect(object!.externalSystem).toBeNull();
    expect(object!.externalId).toBeNull();
  });

  it('records where the extraction came from alongside the payload', async () => {
    await proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate({ rawExtractRef: 's3://extracts/abc.json', extractionNotes: 'End time missing.' }),
    });

    const [object] = await objectsFor();

    expect(object!.metadata).toMatchObject({
      _provenance: {
        sourceUrl: 'https://listings.example.org/events/open-mic-night',
        sourceListingUrl: 'https://listings.example.org/events',
        rawExtractRef: 's3://extracts/abc.json',
        extractionNotes: 'End time missing.',
      },
    });
  });

  it('refreshes the one row when the same candidate is scraped again', async () => {
    const first = await proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate(),
    });
    const second = await proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate({ summary: 'Sign-ups at 7, music at 7:30. Free.' }),
    });

    expect(second.runId).toBe(first.runId);

    const objects = await objectsFor();

    // One queue item AND one object — the refresh must not fork either.
    expect(objects).toHaveLength(1);
    expect(objects[0]!.summary).toMatch(/Free\.$/);
  });

  it('still queues when the workspace has not applied the object type, and says so', async () => {
    await db.delete(businessObjectTypeSchema);

    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate(),
    });
    const card = await objectProposeCandidateAction.reviewCard!({ orgId: ORG }, parse());

    expect(proposed.status).toBe('pending');
    expect(await objectsFor()).toHaveLength(0);
    expect(fieldValue(card.fields, 'Unknown record type')?.value).toMatch(/event_candidate/);
  });
});

describe('the review card', () => {
  it('labels and orders the payload from the object type, not from core', async () => {
    const card = await objectProposeCandidateAction.reviewCard!({ orgId: ORG }, parse());

    expect(card.title).toBe('Open Mic Night');
    expect(card.system).toBe('Event candidate');
    // Schema order, schema titles — core supplies neither.
    expect(card.fields.slice(0, 4).map(field => field.label)).toEqual(['Event', 'Starts', 'Venue', 'Categories']);
    expect(fieldValue(card.fields, 'Categories')?.value).toBe('Music');
    expect(fieldValue(card.fields, 'Source')).toEqual({
      label: 'Source',
      value: 'listings.example.org',
      href: 'https://listings.example.org/events/open-mic-night',
    });
    expect(card.verbs).toEqual({ approve: 'Approve', reject: 'Reject' });
    expect(card.nextAction).toMatch(/Nothing is written outside from here/);
  });

  it('humanises a field the object type does not describe rather than hiding it', async () => {
    const card = await objectProposeCandidateAction.reviewCard!(
      { orgId: ORG },
      parse({ fields: { title: 'Open Mic Night', start: '2026-09-12T19:30', ticketPriceUsd: 0 } }),
    );

    expect(fieldValue(card.fields, 'Ticket Price Usd')?.value).toBe('0');
  });

  it('flags a payload that does not match the record type, without refusing it', async () => {
    const card = await objectProposeCandidateAction.reviewCard!(
      { orgId: ORG },
      parse({ fields: { title: 'Open Mic Night' } }),
    );

    expect(fieldValue(card.fields, 'Does not match the record type')?.value).toMatch(/start/);
    expect(card.recommendation?.detail).toMatch(/does not match the record type/);
  });

  it('re-reads an edited schema instead of serving the old verdict', async () => {
    // The compiled validators are cached by schema text; a workspace that
    // tightens its object type must not keep passing under the old rules.
    const loose = await objectProposeCandidateAction.reviewCard!(
      { orgId: ORG },
      parse({ fields: { title: 'Open Mic Night', start: '2026-09-12T19:30' } }),
    );

    expect(fieldValue(loose.fields, 'Does not match the record type')).toBeUndefined();

    await db.delete(businessObjectTypeSchema);
    await seedObjectType(ORG, { ...EVENT_CANDIDATE_SCHEMA, required: ['title', 'start', 'venue'] });
    const tightened = await objectProposeCandidateAction.reviewCard!(
      { orgId: ORG },
      parse({ fields: { title: 'Open Mic Night', start: '2026-09-12T19:30' } }),
    );

    expect(fieldValue(tightened.fields, 'Does not match the record type')?.value).toMatch(/venue/);
  });

  it('says nothing about the shape when the object type declares no schema', async () => {
    await db.delete(businessObjectTypeSchema);
    await seedObjectType(ORG, null);

    const card = await objectProposeCandidateAction.reviewCard!(
      { orgId: ORG },
      parse({ fields: { anything: 'goes' } }),
    );

    expect(fieldValue(card.fields, 'Does not match the record type')).toBeUndefined();
  });

  it('drops the "found on" row when the deep link IS the listing', async () => {
    const url = 'https://listings.example.org/events';
    const card = await objectProposeCandidateAction.reviewCard!(
      { orgId: ORG },
      parse({ sourceUrl: url, sourceListingUrl: url }),
    );

    expect(fieldValue(card.fields, 'Found on')).toBeUndefined();
  });

  it('renders a source image as typed content when there is one', async () => {
    const withImage = await objectProposeCandidateAction.reviewCard!(
      { orgId: ORG },
      parse({ imageUrl: 'https://listings.example.org/img/open-mic.jpg' }),
    );
    const withoutImage = await objectProposeCandidateAction.reviewCard!({ orgId: ORG }, parse());

    expect(withImage.content).toEqual([{
      kind: 'image',
      id: 'source-image',
      label: 'Source image',
      url: 'https://listings.example.org/img/open-mic.jpg',
      caption: 'Open Mic Night',
    }]);
    expect(withoutImage.content).toBeUndefined();
  });

  it('renders a source-less candidate without inventing links', async () => {
    const card = await objectProposeCandidateAction.reviewCard!(
      { orgId: ORG },
      parse({ sourceUrl: undefined, sourceListingUrl: undefined }),
    );

    expect(fieldValue(card.fields, 'Source')).toBeUndefined();
    expect(card.links).toBeUndefined();
    expect(card.subject?.company).toBeUndefined();
    expect(card.provenance?.[0]).toEqual({ label: 'Found on', value: 'an unnamed source' });
  });

  it('shows the extractor\'s notes so the reviewer sees what it could not resolve', async () => {
    const card = await objectProposeCandidateAction.reviewCard!(
      { orgId: ORG },
      parse({ extractionNotes: 'No end time on the page.' }),
    );

    expect(fieldValue(card.fields, 'Extraction notes')?.value).toBe('No end time on the page.');
  });

  it('flattens a nested value, and skips one the extractor left empty', async () => {
    const card = await objectProposeCandidateAction.reviewCard!({ orgId: ORG }, parse({
      fields: {
        title: 'Open Mic Night',
        start: '2026-09-12T19:30',
        venue: null,
        organiser: { name: 'Flynn Arts', phone: '802-555-0100' },
      },
    }));

    // A null field is absent, not a row reading "null".
    expect(fieldValue(card.fields, 'Venue')).toBeUndefined();
    expect(fieldValue(card.fields, 'Organiser')?.value).toBe('{"name":"Flynn Arts","phone":"802-555-0100"}');
  });

  it('lists a described field that propertyOrder forgot, after the ones it named', async () => {
    await db.delete(businessObjectTypeSchema);
    await seedObjectType(ORG, {
      type: 'object',
      propertyOrder: ['title'],
      properties: {
        title: { type: 'string', title: 'Event' },
        venue: { type: 'string', title: 'Venue' },
      },
    });

    const card = await objectProposeCandidateAction.reviewCard!({ orgId: ORG }, parse());

    // `title` first because it was named; `venue` still described, so it comes
    // before anything the schema never mentions; then the undescribed keys,
    // alphabetically.
    expect(card.fields.slice(0, 4).map(field => field.label)).toEqual(['Event', 'Venue', 'Categories', 'Start']);
  });

  it('reports a schema it cannot compile instead of failing the card', async () => {
    await db.delete(businessObjectTypeSchema);
    await seedObjectType(ORG, { type: 'object', properties: { title: { type: 'not-a-json-schema-type' } } });

    const card = await objectProposeCandidateAction.reviewCard!({ orgId: ORG }, parse());

    expect(fieldValue(card.fields, 'Does not match the record type')?.value).toMatch(/could not be read/);
  });

  it('leaves confidence to the card shell rather than printing a second copy', async () => {
    const card = await objectProposeCandidateAction.reviewCard!({ orgId: ORG }, parse());

    expect(card.fields.map(field => field.label)).not.toContain('Confidence');
  });
});

describe('the duplicate flag', () => {
  it('flags a candidate matching on the first identity field but not the rest', async () => {
    await proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate({ fields: { title: 'Open Mic Night', start: '2026-09-19T19:30', venue: 'The Flynn' } }),
    });

    const card = await objectProposeCandidateAction.reviewCard!({ orgId: ORG }, parse());

    expect(fieldValue(card.fields, 'Possible duplicate')?.value).toContain('2026-09-19');
    expect(card.recommendation?.headline).toMatch(/merge it with the one already queued/);
  });

  it('stays quiet for a genuinely different candidate', async () => {
    await proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate({ fields: { title: 'Poetry Slam', start: '2026-09-12T19:30', venue: 'The Flynn' } }),
    });

    const card = await objectProposeCandidateAction.reviewCard!({ orgId: ORG }, parse());

    expect(fieldValue(card.fields, 'Possible duplicate')).toBeUndefined();
  });

  it('says nothing when one field is the whole identity — there is no "same but for one value"', async () => {
    await proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate({ dedupOn: ['title'], fields: { title: 'Open Mic Night', start: '2026-09-19T19:30' } }),
    });

    const card = await objectProposeCandidateAction.reviewCard!(
      { orgId: ORG },
      parse({ dedupOn: ['title'] }),
    );

    expect(fieldValue(card.fields, 'Possible duplicate')).toBeUndefined();
  });

  it('ignores a sibling that was already rejected', async () => {
    const sibling = await proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate({ fields: { title: 'Open Mic Night', start: '2026-09-19T19:30', venue: 'The Flynn' } }),
    });
    await rejectAction(sibling.runId, ORG, 'Not a real event');

    const card = await objectProposeCandidateAction.reviewCard!({ orgId: ORG }, parse());

    // A decided-against candidate is not something to merge with.
    expect(fieldValue(card.fields, 'Possible duplicate')).toBeUndefined();
  });

  it('never looks across orgs', async () => {
    await seedObjectType(OTHER_ORG);
    await proposeAction({
      orgId: OTHER_ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(OTHER_ORG),
      input: candidate({ fields: { title: 'Open Mic Night', start: '2026-09-19T19:30', venue: 'The Flynn' } }),
    });

    const card = await objectProposeCandidateAction.reviewCard!({ orgId: ORG }, parse());

    expect(fieldValue(card.fields, 'Possible duplicate')).toBeUndefined();
  });
});

describe('the queue behaviour', () => {
  it('is registered, so the propose API stops answering "No registered action"', () => {
    expect(listActions().map(action => action.id)).toContain('objects.propose_candidate');
  });

  it('queues an identity-less candidate as its own item, never merged with the last one', async () => {
    const first = await proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate({ dedupOn: [], title: 'First find' }),
    });
    const second = await proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate({ dedupOn: [], title: 'Second find' }),
    });

    expect(second.runId).not.toBe(first.runId);
    expect(await objectsFor()).toHaveLength(2);
  });

  it('lands pending — proposing never publishes', async () => {
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate(),
      proposal: { confidence: 0.86, rationale: 'clean per-event page' },
    });

    expect(proposed.status).toBe('pending');
  });

  it('refuses an ungranted caller even when the item already exists', async () => {
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate(),
    });
    const outsider: Principal = { kind: 'agent', id: 'agent:nobody', grants: [], autonomy: 2, scope: { orgId: ORG } };

    // The refresh path writes to the queue item AND the candidate row, so
    // permission has to be settled before it, not after.
    await expect(proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: outsider,
      input: candidate({ title: 'Rewritten by someone with no grant' }),
    })).rejects.toThrow(/Not allowed to run/);

    const [object] = await objectsFor();

    expect(object!.title).toBe('Open Mic Night');
    expect(object!.reviewActionRunId).toBe(proposed.runId);
  });

  it('cannot be auto-approved by a trust rule, however confident the agent is', async () => {
    await db.insert(trustRuleSchema).values({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      threshold: 0.5,
      enabled: 'true',
    });

    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate(),
      proposal: { confidence: 0.99 },
    });

    expect(proposed.status).toBe('pending');
  });
});

describe('deciding a candidate', () => {
  async function propose(over: Record<string, unknown> = {}) {
    return proposeAction({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(),
      input: candidate(over),
    });
  }

  it('approving marks the row approved and writes nowhere', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const proposed = await propose();

    const executed = await executeAction(proposed.runId, ORG, { reviewedBy: 'user_moderator' });

    expect(executed.status).toBe('done');

    const [object] = await objectsFor();

    expect(object!.status).toBe('approved');
    expect(object!.externalId).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('approving with the published record links the two in one call', async () => {
    const proposed = await propose();

    const executed = await executeAction(proposed.runId, ORG, {
      reviewedBy: 'user_moderator',
      externalRef: { system: 'strapi', id: '412' },
    });

    expect(executed.result).toMatchObject({ externalSystem: 'strapi', externalId: '412', status: 'approved' });

    const [object] = await objectsFor();

    expect(object!.externalSystem).toBe('strapi');
    expect(object!.externalId).toBe('412');
    // The result names the row the panel just published against.
    expect(executed.result).toMatchObject({ objectId: object!.id });
  });

  it('rejecting keeps the payload — the row is the record of what went wrong', async () => {
    const proposed = await propose();

    await rejectAction(proposed.runId, ORG, 'Duplicate of the 19th', { reviewedBy: 'user_moderator' });

    const [object] = await objectsFor();

    expect(object!.status).toBe('rejected');
    expect(object!.metadata).toMatchObject({ venue: 'The Flynn' });
  });

  it('fails loudly when there is no stored row to approve', async () => {
    await db.delete(businessObjectTypeSchema);
    const proposed = await propose();

    const executed = await executeAction(proposed.runId, ORG, { reviewedBy: 'user_moderator' });

    expect(executed.status).toBe('failed');

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposed.runId));

    expect(run!.error).toMatch(/Apply the workspace object type/);
  });

  it('stores no author when the proposal named none', async () => {
    // proposeAction always stamps one; a direct caller of the hook need not.
    await objectProposeCandidateAction.onProposed!({ orgId: ORG }, parse(), 4242);

    const [object] = await objectsFor();

    expect(object!.createdBy).toBeNull();
    expect(object!.reviewActionRunId).toBe(4242);
  });

  it('refuses to approve without knowing which run it is deciding', async () => {
    await propose();

    // No runId on the context — there is no row this could safely move.
    await expect(objectProposeCandidateAction.execute({ orgId: ORG }, parse()))
      .rejects
      .toThrow(/Apply the workspace object type/);
  });

  it('never touches another org\'s candidate', async () => {
    await seedObjectType(OTHER_ORG);
    const mine = await propose();
    await proposeAction({
      orgId: OTHER_ORG,
      actionId: 'objects.propose_candidate',
      principal: ingestionAgent(OTHER_ORG),
      input: candidate(),
    });

    await executeAction(mine.runId, ORG, { reviewedBy: 'user_moderator' });

    const [theirs] = await db
      .select()
      .from(businessObjectSchema)
      .where(and(eq(businessObjectSchema.orgId, OTHER_ORG), eq(businessObjectSchema.title, 'Open Mic Night')));

    expect(theirs!.status).toBe('candidate');
  });
});
