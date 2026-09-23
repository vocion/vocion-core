import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, businessObjectSchema, businessObjectTypeSchema, objectDocumentLinkSchema } = await import('@/models/Schema');
const { CANDIDATE_STATUS, candidateDedupKey } = await import('@/libs/actions/objects-propose-candidate');
const { candidateExtractorConfigSchema } = await import('./config');
const { keepIdentity, loadDocumentCards } = await import('./identity');
const { resolveRecords } = await import('./resolve');
const { and, eq } = await import('drizzle-orm');

const ORG = 'org_keep_identity';
const OTHER_ORG = 'org_keep_identity_other';
const SOURCE = 'ashby-library';
const DOC = 'https://ashbylibrary.example/events';
const DEDUP_ON = ['title', 'startDate', 'venueName'];

function configWith(over: Record<string, unknown> = {}) {
  return candidateExtractorConfigSchema.parse({
    objectType: 'event-candidate',
    agentSlug: 'event-ingestion-lead',
    dedupOn: DEDUP_ON,
    titleFrom: 'title',
    promptFragment: 'Only public events.',
    keepIdentityOnReread: { sameOn: ['title', 'startDate'] },
    ...over,
  });
}

function keyOf(fields: Record<string, unknown>, objectType = 'event-candidate') {
  return candidateDedupKey({ objectType, fields, dedupOn: DEDUP_ON }) as string;
}

function record(fields: Record<string, unknown>, refs: { duplicateOf?: number; seriesOf?: number } = {}) {
  return {
    fields: { ...fields },
    confidence: 0.9,
    issues: [] as string[],
    suggestedDecision: 'approve' as const,
    suggestedDecisionReason: 'Public listing with a date and a venue.',
    ...refs,
  };
}

async function typeId(org: string, slug: string): Promise<number> {
  const [found] = await db
    .select({ id: businessObjectTypeSchema.id })
    .from(businessObjectTypeSchema)
    .where(and(eq(businessObjectTypeSchema.orgId, org), eq(businessObjectTypeSchema.slug, slug)));
  if (found) {
    return found.id;
  }
  const [row] = await db.insert(businessObjectTypeSchema).values({ orgId: org, slug, label: slug, schema: {} }).returning({ id: businessObjectTypeSchema.id });
  return row!.id;
}

async function fileCard(opts: {
  fields: Record<string, unknown>;
  status?: string;
  document?: string;
  source?: string;
  org?: string;
  actionId?: string;
  objectType?: string;
  dedupKey?: string | null;
}): Promise<{ runId: number; dedupKey: string }> {
  const org = opts.org ?? ORG;
  const objectType = opts.objectType ?? 'event-candidate';
  const dedupKey = opts.dedupKey === undefined ? keyOf(opts.fields, objectType) : opts.dedupKey;
  const [run] = await db.insert(actionRunSchema).values({
    orgId: org,
    actionId: opts.actionId ?? 'objects.propose_candidate',
    status: opts.status ?? 'pending',
    dedupKey,
    input: { objectType, title: String(opts.fields.title ?? ''), fields: opts.fields, dedupOn: DEDUP_ON },
  }).returning({ id: actionRunSchema.id });
  const [object] = await db.insert(businessObjectSchema).values({
    orgId: org,
    typeId: await typeId(org, objectType),
    title: String(opts.fields.title ?? ''),
    status: CANDIDATE_STATUS.proposed,
    metadata: opts.fields,
    reviewActionRunId: run!.id,
  }).returning({ id: businessObjectSchema.id });
  await db.insert(objectDocumentLinkSchema).values({
    objectId: object!.id,
    onyxDocumentId: opts.document ?? DOC,
    sourceType: opts.source ?? SOURCE,
    role: 'source',
    link: opts.document ?? DOC,
  });
  return { runId: run!.id, dedupKey: dedupKey ?? '' };
}

async function storedFor(document = DOC, config = configWith()) {
  const cards = await loadDocumentCards({ orgId: ORG, sourceSlug: SOURCE, config, syncContext: { cache: new Map() } });
  return cards.get(document) ?? [];
}

const PAIRS = [
  { shape: 'a hall that later adds "[and online]", 11-09', title: 'Parents Book Circle', startDate: '2026-11-09', stored: 'Ashby Library', read: 'Ashby Library [and online]' },
  { shape: 'a hall that later adds "[and online]", 10-12', title: 'Parents Book Circle', startDate: '2026-10-12', stored: 'Ashby Library', read: 'Ashby Library [and online]' },
  { shape: 'one call platform worded two ways, with a moved start', title: 'Midweek Zoom Check-in', startDate: '2026-12-16', stored: 'Online (Zoom)', read: 'Zoom (Virtual)', storedStart: '2026-12-16T19:45', readStart: '2026-12-16T20:45' },
  { shape: 'a venue being rehomed, 11-04', title: 'Songwriter Night', startDate: '2026-11-04', stored: 'TBD (venue being rehomed)', read: 'TBD' },
  { shape: 'a venue being rehomed, 11-06', title: 'Folk Duo Evening', startDate: '2026-11-06', stored: 'TBD (venue being rehomed)', read: 'TBD' },
  { shape: 'a garden abbreviation against the full building name', title: 'Harvest Gathering', startDate: '2026-09-27', stored: 'MCL Garden', read: 'Mill Creek Library' },
];

describe('keeping a card\'s identity when its own document is read again', () => {
  beforeEach(async () => {
    for (const org of [ORG, OTHER_ORG]) {
      await db.delete(businessObjectSchema).where(eq(businessObjectSchema.orgId, org));
      await db.delete(actionRunSchema).where(eq(actionRunSchema.orgId, org));
      await db.delete(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, org));
    }
  });

  it.each(PAIRS)('keeps the stored wording for $shape', async (pair) => {
    const card = await fileCard({
      fields: { title: pair.title, startDate: pair.startDate, venueName: pair.stored, ...(pair.storedStart ? { start: pair.storedStart } : {}) },
    });
    const reread = record({ title: pair.title, startDate: pair.startDate, venueName: pair.read, ...(pair.readStart ? { start: pair.readStart } : {}) });

    const counts = keepIdentity({ config: configWith(), records: [reread], stored: await storedFor() });

    expect(counts).toEqual({ identity_kept: 1 });
    expect(reread.fields.venueName).toBe(pair.stored);
    expect(keyOf(reread.fields)).toBe(card.dedupKey);
    expect(reread.issues).toEqual([
      `venueName: read as "${pair.read}" this time; kept "${pair.stored}" from card #${card.runId}, which this document filed`,
    ]);

    if (pair.readStart) {
      expect(reread.fields.start).toBe(pair.readStart);
    }
  });

  it('leaves a record alone when the card it resembles came from another document of the source', async () => {
    await fileCard({
      document: 'https://themarlow.example/events#1001~1002',
      fields: { title: 'Visual Mapping Workshop', startDate: '2026-09-25', venueName: 'Online (Virtual)' },
    });
    const reread = record({ title: 'Visual Mapping Workshop', startDate: '2026-09-25', venueName: 'Online (Microsoft Teams)' });

    const counts = keepIdentity({ config: configWith(), records: [reread], stored: await storedFor('https://themarlow.example/events#1003~1004') });

    expect(counts).toEqual({});
    expect(reread.fields.venueName).toBe('Online (Microsoft Teams)');
    expect(reread.issues).toEqual([]);
  });

  it('leaves both records alone when this read has two with one title and day', async () => {
    await fileCard({ fields: { title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library' } });
    const upstairs = record({ title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'The Corvina' });
    const downstairs = record({ title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'The Marlow' });

    const counts = keepIdentity({ config: configWith(), records: [upstairs, downstairs], stored: await storedFor() });

    expect(counts).toEqual({});
    expect(upstairs.fields.venueName).toBe('The Corvina');
    expect(downstairs.fields.venueName).toBe('The Marlow');
  });

  it('leaves a record alone when its own key is already the anchor\'s', async () => {
    await fileCard({ fields: { title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library' } });
    const reread = record({ title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'ashby library' });

    const counts = keepIdentity({ config: configWith(), records: [reread], stored: await storedFor() });

    expect(counts).toEqual({});
    expect(reread.fields.venueName).toBe('ashby library');
    expect(reread.issues).toEqual([]);
  });

  it('leaves a record alone when its key is another open card of this document', async () => {
    const roomA = await fileCard({ fields: { title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Room A' } });
    const roomB = await fileCard({ fields: { title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Room B' } });
    const reread = record({ title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Room B' });

    const counts = keepIdentity({ config: configWith(), records: [reread], stored: await storedFor() });

    expect(roomA.runId).toBeLessThan(roomB.runId);
    expect(counts).toEqual({});
    expect(reread.fields.venueName).toBe('Room B');
    expect(keyOf(reread.fields)).toBe(roomB.dedupKey);
    expect(reread.issues).toEqual([]);
  });

  it('leaves a record alone when the sameOn fields are not all identity fields', async () => {
    await fileCard({ fields: { title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library' } });
    const config = configWith({ keepIdentityOnReread: { sameOn: ['title', 'venueCity'] } });
    const reread = record({ title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library [and online]' });

    expect(keepIdentity({ config, records: [reread], stored: await storedFor(DOC, config) })).toEqual({});
    expect(reread.fields.venueName).toBe('Ashby Library [and online]');
  });

  it.each(['duplicateOf', 'seriesOf'] as const)('drops a %s naming the card being kept, with no seriesLabel to catch it', async (field) => {
    const card = await fileCard({ fields: { title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library' } });
    const other = await fileCard({ document: 'https://ashbylibrary.example/calendar', fields: { title: 'Poetry Slam', startDate: '2026-11-13', venueName: 'Ashby Library' } });
    const config = configWith();
    const reread = record({ title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library [and online]' }, { [field]: card.runId });
    const elsewhere = record({ title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library [and online]' }, { [field]: other.runId });

    expect(config.seriesLabel).toBeUndefined();
    expect(keepIdentity({ config, records: [reread], stored: await storedFor() })).toEqual({ identity_kept: 1, identity_self_match: 1 });
    expect(reread[field]).toBeUndefined();
    expect(reread.issues).toContain(`${field}: the model matched the card this record refreshes (#${card.runId}), so it was ignored`);

    expect(keepIdentity({ config, records: [elsewhere], stored: await storedFor() })).toEqual({ identity_kept: 1 });
    expect(elsewhere[field]).toBe(other.runId);
  });

  it('leaves a record alone when the title differs', async () => {
    await fileCard({ fields: { title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library' } });
    const reread = record({ title: 'Poetry Slam', startDate: '2026-11-12', venueName: 'Ashby Library [and online]' });

    expect(keepIdentity({ config: configWith(), records: [reread], stored: await storedFor() })).toEqual({});
    expect(reread.fields.venueName).toBe('Ashby Library [and online]');
  });

  it('leaves a record alone when it and the stored card both lack a start date', async () => {
    await fileCard({ fields: { title: 'Open Mic Night', venueName: 'Ashby Library' } });
    const reread = record({ title: 'Open Mic Night', venueName: 'Ashby Library [and online]' });

    const counts = keepIdentity({ config: configWith(), records: [reread], stored: await storedFor() });

    expect(counts).toEqual({});
    expect(reread.fields.venueName).toBe('Ashby Library [and online]');
    expect(reread.issues).toEqual([]);
  });

  it('ignores a card of another object type the document also filed', async () => {
    await fileCard({ objectType: 'venue-candidate', fields: { title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library' } });
    const reread = record({ title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library [and online]' });

    expect(keepIdentity({ config: configWith(), records: [reread], stored: await storedFor() })).toEqual({});
  });

  it('leaves a record alone when the stored fields do not rebuild the stored key', async () => {
    await fileCard({
      fields: { title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library Annex' },
      dedupKey: keyOf({ title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library' }),
    });
    const reread = record({ title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library [and online]' });

    const counts = keepIdentity({ config: configWith(), records: [reread], stored: await storedFor() });

    expect(counts).toEqual({ identity_not_kept: 1 });
    expect(reread.fields.venueName).toBe('Ashby Library [and online]');
    expect(reread.issues).toEqual([]);
  });

  it('leaves a record alone when the card it would refresh has no venue and this read found one', async () => {
    await fileCard({ fields: { title: 'Open Mic Night', startDate: '2026-11-12' } });
    const reread = record({ title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'The Corvina' });

    const counts = keepIdentity({ config: configWith(), records: [reread], stored: await storedFor() });

    expect(counts).toEqual({ identity_not_kept: 1 });
    expect(reread.fields.venueName).toBe('The Corvina');
    expect(reread.issues).toEqual([]);
  });

  describe('which card anchors the record', () => {
    const zoom = { title: 'Midweek Zoom Check-in', startDate: '2026-12-16' };

    it.each([
      ['a drifted read', 'Zoom meeting online'],
      ['a read worded exactly like the rejected twin', 'Online (Zoom)'],
    ])('refreshes the open card over an older rejected twin on %s', async (_label, read) => {
      await fileCard({ status: 'rejected', fields: { ...zoom, venueName: 'Online (Zoom)', start: '2026-12-16T19:45' } });
      const open = await fileCard({ fields: { ...zoom, venueName: 'Zoom (Virtual)', start: '2026-12-16T20:45' } });
      const reread = record({ ...zoom, venueName: read, start: '2026-12-16T20:45' });

      const counts = keepIdentity({ config: configWith(), records: [reread], stored: await storedFor() });

      expect(counts).toEqual({ identity_kept: 1 });
      expect(reread.fields.venueName).toBe('Zoom (Virtual)');
      expect(keyOf(reread.fields)).toBe(open.dedupKey);
    });

    it('refreshes the open card over an older rejected one when the venue was being rehomed', async () => {
      const show = { title: 'Songwriter Night', startDate: '2026-11-04' };
      await fileCard({ status: 'rejected', fields: { ...show, venueName: 'TBD (venue being rehomed)' } });
      const open = await fileCard({ fields: { ...show, venueName: 'TBD' } });
      const reread = record({ ...show, venueName: 'TBD (venue being rehomed)' });

      keepIdentity({ config: configWith(), records: [reread], stored: await storedFor() });

      expect(keyOf(reread.fields)).toBe(open.dedupKey);
    });

    it.each(['done', 'rejected'])('anchors on a %s card when it is the only one, so the proposal stops at the decision', async (status) => {
      const decided = await fileCard({ status, fields: { title: 'Parents Book Circle', startDate: '2026-11-09', venueName: 'Ashby Library' } });
      const reread = record({ title: 'Parents Book Circle', startDate: '2026-11-09', venueName: 'Ashby Library [and online]' });

      expect(keepIdentity({ config: configWith(), records: [reread], stored: await storedFor() })).toEqual({ identity_kept: 1, identity_kept_decided: 1 });
      expect(keyOf(reread.fields)).toBe(decided.dedupKey);
    });

    it('prefers the open twin over an older done card', async () => {
      await fileCard({ status: 'done', fields: { title: 'Parents Book Circle', startDate: '2026-11-09', venueName: 'Ashby Library' } });
      const open = await fileCard({ status: 'failed', fields: { title: 'Parents Book Circle', startDate: '2026-11-09', venueName: 'Ashby Library [and online]' } });
      const reread = record({ title: 'Parents Book Circle', startDate: '2026-11-09', venueName: 'Ashby Library, and online' });

      keepIdentity({ config: configWith(), records: [reread], stored: await storedFor() });

      expect(keyOf(reread.fields)).toBe(open.dedupKey);
    });

    it.each([
      ['open', 'pending'],
      ['done', 'done'],
    ])('leaves the record alone when two %s cards with different keys match', async (_label, status) => {
      await fileCard({ status, fields: { title: 'Parents Book Circle', startDate: '2026-10-12', venueName: 'Ashby Library' } });
      await fileCard({ status, fields: { title: 'Parents Book Circle', startDate: '2026-10-12', venueName: 'Mill Creek Library' } });
      const reread = record({ title: 'Parents Book Circle', startDate: '2026-10-12', venueName: 'Ashby Library (hybrid)' });

      const counts = keepIdentity({ config: configWith(), records: [reread], stored: await storedFor() });

      expect(counts).toEqual({ identity_ambiguous: 1 });
      expect(reread.fields.venueName).toBe('Ashby Library (hybrid)');
      expect(reread.issues).toEqual([]);
    });

    it('never anchors on an approved, executing or undone card', async () => {
      for (const status of ['approved', 'executing', 'undone']) {
        await fileCard({ status, fields: { title: 'Parents Book Circle', startDate: '2026-11-09', venueName: `Ashby Library ${status}` } });
      }
      const reread = record({ title: 'Parents Book Circle', startDate: '2026-11-09', venueName: 'Ashby Library [and online]' });

      expect(keepIdentity({ config: configWith(), records: [reread], stored: await storedFor() })).toEqual({});
    });
  });

  it('keeps the stored spelling when resolve rewrote the venue to the approved one', async () => {
    const config = configWith({
      resolveAgainst: [{
        objectType: 'venue-candidate',
        matchFields: { venueName: 'name', venueCity: 'city' },
        normalise: { venueName: { dropWords: ['the'] } },
      }],
    });
    const card = await fileCard({ fields: { title: 'Late Set', startDate: '2026-11-20', venueName: 'Corvina', venueCity: 'Riverton' } });
    await db.insert(businessObjectSchema).values({
      orgId: ORG,
      typeId: await typeId(ORG, 'venue-candidate'),
      title: 'The Corvina',
      status: CANDIDATE_STATUS.approved,
      metadata: { name: 'The Corvina', city: 'Riverton' },
    });
    const reread = record({ title: 'Late Set', startDate: '2026-11-20', venueName: 'Corvina', venueCity: 'riverton' });
    const syncContext = { cache: new Map<string, unknown>() };

    const resolved = await resolveRecords({ orgId: ORG, config, records: [reread], syncContext });

    expect(resolved.resolved.has(0)).toBe(true);
    expect(reread.fields.venueName).toBe('The Corvina');

    const counts = keepIdentity({ config, records: [reread], stored: await storedFor(DOC, config) });

    expect(counts).toEqual({ identity_kept: 1 });
    expect(reread.fields.venueName).toBe('Corvina');
    expect(reread.fields.venueCity).toBe('Riverton');
    expect(keyOf(reread.fields)).toBe(card.dedupKey);
  });

  describe('the document cards', () => {
    it('reads only this org\'s candidate cards linked from this source, grouped by document', async () => {
      const fields = { title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library' };
      const mine = await fileCard({ fields });
      const otherDocument = await fileCard({ fields, document: 'https://ashbylibrary.example/calendar' });
      await fileCard({ fields, source: 'the-corvina' });
      await fileCard({ fields, org: OTHER_ORG });
      await fileCard({ fields, actionId: 'gmail.send' });
      await fileCard({ fields, dedupKey: null });

      const cards = await loadDocumentCards({ orgId: ORG, sourceSlug: SOURCE, config: configWith(), syncContext: { cache: new Map() } });

      expect([...cards.keys()].sort()).toEqual(['https://ashbylibrary.example/calendar', DOC]);
      expect(cards.get(DOC)?.map(card => card.runId)).toEqual([mine.runId]);
      expect(cards.get('https://ashbylibrary.example/calendar')?.map(card => card.runId)).toEqual([otherDocument.runId]);
      expect(cards.get(DOC)?.[0]).toMatchObject({ status: 'pending', dedupKey: mine.dedupKey, fields });
    });

    it('reads once per sync, one promise shared by the documents in flight', async () => {
      await fileCard({ fields: { title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library' } });
      const syncContext = { cache: new Map<string, unknown>() };
      const opts = { orgId: ORG, sourceSlug: SOURCE, config: configWith(), syncContext };

      const first = loadDocumentCards(opts);
      const second = loadDocumentCards(opts);

      expect(second).toBe(first);

      await first;
      await fileCard({ fields: { title: 'Poetry Slam', startDate: '2026-11-13', venueName: 'Ashby Library' } });

      expect((await loadDocumentCards(opts)).get(DOC)).toHaveLength(1);
    });

    it('reads nothing and changes nothing without the knob', async () => {
      await fileCard({ fields: { title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library' } });
      const select = vi.spyOn(db, 'select');
      onTestFinished(() => select.mockRestore());
      const config = configWith({ keepIdentityOnReread: undefined });
      const reread = record({ title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library [and online]' });

      const cards = await loadDocumentCards({ orgId: ORG, sourceSlug: SOURCE, config, syncContext: { cache: new Map() } });
      const stored = [{ runId: 1, status: 'pending', dedupKey: keyOf({ title: 'Open Mic Night', startDate: '2026-11-12', venueName: 'Ashby Library' }), fields: {} }];

      expect(cards.size).toBe(0);
      expect(select).not.toHaveBeenCalled();
      expect(keepIdentity({ config, records: [reread], stored })).toEqual({});
      expect(reread.fields.venueName).toBe('Ashby Library [and online]');
    });
  });
});
