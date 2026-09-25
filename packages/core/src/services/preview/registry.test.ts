/**
 * The preview resolvers against PGlite: one fixture document per evidence
 * kind, plus the two cases that matter more than the happy path — a reference
 * we hold nothing for, and a record type nothing knows how to read. Neither
 * may throw and neither may render blank.
 *
 * Every id, address, title and name below is invented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceAccessService', () => ({ allowedSourceSlugsForUser: vi.fn(async () => undefined) }));

const { db } = await import('@/libs/DB');
const { knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema, briefingSchema, artifactSchema } = await import('@/models/Schema');
const { resolvePreview, previewTypes } = await import('./registry');
await import('./descriptors');

const ORG = 'org_preview_test';
const CTX = { orgId: ORG, userId: null };

type SeedDoc = {
  slug: string;
  kind: string;
  externalId: string;
  title: string;
  metadata: Record<string, unknown>;
  content: string;
  uri?: string;
};

async function seedDocument(doc: SeedDoc) {
  const [source] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG, slug: doc.slug, name: doc.slug, kind: doc.kind } as never)
    .returning({ id: knowledgeSourceSchema.id });
  const [row] = await db
    .insert(knowledgeDocumentSchema)
    .values({
      orgId: ORG,
      sourceId: source!.id,
      externalId: doc.externalId,
      title: doc.title,
      uri: doc.uri ?? null,
      metadata: doc.metadata,
      contentHash: `hash-${doc.externalId}`,
    } as never)
    .returning({ id: knowledgeDocumentSchema.id });
  await db.insert(knowledgeChunkSchema).values({ orgId: ORG, documentId: row!.id, chunkIdx: 0, content: doc.content, contentTokens: doc.content.length, embedding: Array.from({ length: 1536 }, () => 0) } as never);
  return row!.id;
}

beforeEach(async () => {
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
  await db.delete(briefingSchema);
  await db.delete(artifactSchema);
});

describe('the registry', () => {
  it('is the only list of previewable types', () => {
    expect(previewTypes()).toEqual(['artifact', 'briefing', 'conversation', 'deal', 'document', 'lead', 'object', 'page', 'worker_run']);
  });
});

describe('evidence kinds', () => {
  it('resolves a Granola note by its external id, and names it', async () => {
    await seedDocument({
      slug: 'granola',
      kind: 'granola',
      externalId: 'granola:9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f',
      title: 'Platform kickoff',
      metadata: { kind: 'granola-note', summary: 'Scope and timeline agreed.', participants: ['Fixture One', 'Fixture Two'] },
      content: 'Transcript body for the fixture meeting.',
    });

    const doc = await resolvePreview({ type: 'document', id: 'granola:9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f' }, CTX);

    expect(doc.unresolved).toBeUndefined();
    expect(doc.title).toBe('Platform kickoff');
    expect(doc.sourceLabel).toBe('Granola');
    expect(doc.subtitle).toBe('Scope and timeline agreed.');
    expect(doc.body).toContain('Transcript body');
    expect(doc.href).toMatch(/^\/dashboard\/search\/\d+$/);
    expect(doc.facts?.find(f => f.label === 'Participants')?.value).toBe('Fixture One, Fixture Two');
  });

  it('resolves a Zoom meeting cited by its TITLE, not the uuid the connector stored', async () => {
    await seedDocument({
      slug: 'zoom',
      kind: 'zoom',
      externalId: 'zoom:11112222-3333-4444-5555-666677778888',
      title: 'Quarterly review',
      metadata: { kind: 'zoom-recording', startTime: '2026-01-08T15:00:00Z', recordingUrl: 'https://zoom.test/rec/fixture' },
      content: 'Recording transcript for the fixture meeting.',
    });

    const doc = await resolvePreview({ type: 'document', id: 'zoom:Quarterly review' }, CTX);

    expect(doc.unresolved).toBeUndefined();
    expect(doc.sourceLabel).toBe('Zoom');
    expect(doc.title).toBe('Quarterly review');
    expect(doc.externalHref).toBe('https://zoom.test/rec/fixture');
  });

  it('resolves a Gmail message cited by its SUBJECT', async () => {
    await seedDocument({
      slug: 'gmail',
      kind: 'gmail',
      externalId: 'gmail:0000aaaa1111bbbb',
      title: 'Re: renewal paperwork',
      metadata: { kind: 'gmail-message', from: 'someone@example.test', to: 'someone-else@example.test' },
      content: 'Message body for the fixture thread.',
    });

    const doc = await resolvePreview({ type: 'document', id: 'gmail:Re: renewal paperwork' }, CTX);

    expect(doc.sourceLabel).toBe('Gmail');
    expect(doc.facts?.find(f => f.label === 'From')?.value).toBe('someone@example.test');
    expect(doc.body).toContain('Message body');
  });

  it('follows a gmail message id to the mirrored thread', async () => {
    await seedDocument({
      slug: 'gmail',
      kind: 'gmail',
      externalId: 'gmail-thread:0000aaaa1111bbbb',
      title: 'Re: renewal paperwork',
      metadata: { kind: 'gmail-thread' },
      content: 'Thread body.',
    });

    const doc = await resolvePreview({ type: 'document', id: 'gmail:0000aaaa1111bbbb' }, CTX);

    expect(doc.unresolved).toBeUndefined();
    expect(doc.title).toBe('Re: renewal paperwork');
  });

  it('resolves a CRM record through the spelling the connector actually wrote', async () => {
    // The HubSpot connector stores `deals:<id>`, not `hubspot:deals:<id>`.
    await seedDocument({
      slug: 'hubspot',
      kind: 'hubspot',
      externalId: 'deals:4021',
      title: 'Fixture renewal',
      metadata: { objectType: 'deals', hubspotId: '4021' },
      content: 'Deal stage: proposal sent.',
    });

    const viaCrmSpelling = await resolvePreview({ type: 'deal', id: 'deals:4021' }, CTX);
    const viaHubspotPrefix = await resolvePreview({ type: 'deal', id: 'hubspot:deals:4021' }, CTX);

    expect(viaCrmSpelling.title).toBe('Fixture renewal');
    expect(viaCrmSpelling.sourceLabel).toBe('HubSpot');
    expect(viaHubspotPrefix.title).toBe('Fixture renewal');
  });

  it('says so plainly when a contract has no synced copy, and keeps the reference', async () => {
    // DocuSeal has no connector: nothing in this workspace mirrors it, and a
    // preview must never reach out to find out.
    const doc = await resolvePreview({ type: 'document', id: 'docuseal:7c9a11' }, CTX);

    expect(doc.unresolved).toEqual({
      reason: 'No synced copy of this reference was found in this workspace.',
      reference: 'docuseal:7c9a11',
    });
    expect(doc.title).toBeTruthy();
  });

  it('answers for a record type nothing knows how to read', async () => {
    const doc = await resolvePreview({ type: 'mission', id: 'weekly-sweep', label: 'Weekly sweep' }, CTX);

    expect(doc.unresolved?.reason).toContain('Nothing in Vocion reads this kind of reference yet');
    expect(doc.unresolved?.reference).toBe('weekly-sweep');
    expect(doc.title).toBe('Weekly sweep');
  });

  it('shows a bare link as where it goes, labelled as leaving', async () => {
    const doc = await resolvePreview({ type: 'page', id: 'https://example.test/report' }, CTX);

    expect(doc.unresolved).toBeUndefined();
    expect(doc.externalHref).toBe('https://example.test/report');
    expect(doc.href).toBeUndefined();
  });

  it('never leaks another org\'s document', async () => {
    await seedDocument({ slug: 'granola', kind: 'granola', externalId: 'granola:aaaa', title: 'Fixture note', metadata: {}, content: 'x' });
    await db.update(knowledgeDocumentSchema).set({ orgId: 'some_other_org' });

    const doc = await resolvePreview({ type: 'document', id: 'granola:aaaa' }, CTX);

    expect(doc.unresolved).toBeTruthy();
  });
});

describe('first-party records', () => {
  it('resolves a briefing', async () => {
    const [row] = await db
      .insert(briefingSchema)
      .values({ orgId: ORG, title: 'Fixture daily brief', content: '## Today\n\nOne thing.', teamSlug: 'fixture-team', agentSlug: 'fixture-lead' } as never)
      .returning({ id: briefingSchema.id });

    const doc = await resolvePreview({ type: 'briefing', id: String(row!.id) }, CTX);

    expect(doc.title).toBe('Fixture daily brief');
    expect(doc.body).toContain('One thing.');
    expect(doc.facts?.find(f => f.label === 'Scope')?.value).toBe('fixture-team');
  });

  it('resolves an artifact and links its full page', async () => {
    const [row] = await db
      .insert(artifactSchema)
      .values({ orgId: ORG, kind: 'markdown', title: 'Fixture plan', spec: { markdown: '# Plan\n\nStep one.' } } as never)
      .returning({ id: artifactSchema.id });

    const doc = await resolvePreview({ type: 'artifact', id: String(row!.id) }, CTX);

    expect(doc.title).toBe('Fixture plan');
    expect(doc.body).toContain('Step one.');
    expect(doc.href).toBe(`/dashboard/artifacts/${row!.id}`);
  });

  it('is unresolved, not broken, for an id that names nothing', async () => {
    const doc = await resolvePreview({ type: 'briefing', id: '999999' }, CTX);

    expect(doc.unresolved).toBeTruthy();
    expect(doc.href).toBe('/dashboard/briefings/999999');
  });
});

describe('CRM names come from the one record namer', () => {
  it('titles a deal with the mirror name #380 resolves, not the document title', async () => {
    // The mirrored row's own title is the id spelled out — the non-answer
    // `resolveRecordLabels` exists to refuse — while `metadata.name` carries
    // what the record is really called.
    await seedDocument({
      slug: 'hubspot',
      kind: 'hubspot',
      externalId: 'deals:7781',
      title: 'deals 7781',
      metadata: { objectType: 'deals', hubspotId: '7781', name: 'Northwind renewal' },
      content: 'Deal stage: contract sent.',
    });

    const doc = await resolvePreview({ type: 'deal', id: 'deals:7781' }, CTX);

    expect(doc.title).toBe('Northwind renewal');
    expect(doc.sourceLabel).toBe('HubSpot');
  });

  it('accepts the inbox spelling of the same key', async () => {
    await seedDocument({
      slug: 'hubspot',
      kind: 'hubspot',
      externalId: 'companies:4410',
      title: 'companies 4410',
      metadata: { objectType: 'companies', name: 'Fixture Industries' },
      content: 'Company record.',
    });

    const doc = await resolvePreview({ type: 'object', id: 'hubspot:companies:4410' }, CTX);

    expect(doc.title).toBe('Fixture Industries');
  });
});
