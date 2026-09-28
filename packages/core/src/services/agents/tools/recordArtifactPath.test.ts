/**
 * A record changes the way an artifact changes (backlog 035), against a real
 * database:
 *
 *   - on a record's page, read_artifact / update_artifact with no id land on
 *     the record's body;
 *   - the edit is a RECORD write — the row, then a new body version with who
 *     and why, under objects.update_meta's trust rule, with Undo — never a
 *     version the row does not know about;
 *   - the page's record is writable by an agent with no objectTypes at all,
 *     and a record off the page, of a type it was not given, is refused;
 *   - a person saving or restoring the body in the artifact pane is the same
 *     record write;
 *   - every landed write emits `version_written` with from → to.
 *
 * Every name is fictional.
 */
import type { AgentEvent, RuntimeContext } from '../types';
import type { MarkdownSpec } from '@/libs/cards/specs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, artifactSchema, artifactVersionSchema, businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { forgetCachedObjectTypes } = await import('@/libs/actions/objects-propose-candidate');
const { undoAction } = await import('@/services/ActionService');
const { listArtifactVersions } = await import('@/services/ArtifactService');
const { recordBody, recordHistory, restoreRecordBodyAsPerson, saveRecordBodyAsPerson } = await import('@/services/objects/recordBody');
const { readArtifactTool, updateArtifactTool } = await import('./editArtifacts');
const { eq } = await import('drizzle-orm');

const ORG = 'org_record_artifact_path';
const PERSON = 'user_rap_priya';

const REQUEST_SCHEMA = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['new', 'triaged', 'in_scope'] },
    priority: { type: 'integer', minimum: 0, maximum: 100 },
    story: { 'type': 'string', 'x-display': { label: 'The story', role: 'prose', order: 2 } },
    acceptance: {
      'type': 'array',
      'x-display': { label: 'Acceptance criteria', role: 'prose', format: 'steps', order: 5 },
      'items': { type: 'object', properties: { statement: { type: 'string' }, met: { type: 'boolean' } } },
    },
  },
};

let requestId = 0;
let productId = 0;

function ctxOnPage(events: AgentEvent[], page: number | null = requestId, objectTypeSlugs: string[] = []): RuntimeContext {
  return {
    orgId: ORG,
    userId: PERSON,
    agentSlug: 'product-manager',
    pageContext: page ? { path: `/dashboard/p/feature/${page}`, title: 'Export the ledger as CSV', record: { type: 'object', id: String(page) } } : undefined,
    connectorSources: [],
    objectTypeSlugs,
    searchConfig: {},
    harnessConfig: {},
    emit: (e: AgentEvent) => events.push(e),
    citationSeq: { current: 0 },
  } as unknown as RuntimeContext;
}

async function readMeta(id = requestId): Promise<Record<string, unknown>> {
  const [row] = await db.select({ metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return (row!.metadata ?? {}) as Record<string, unknown>;
}

beforeEach(async () => {
  forgetCachedObjectTypes();
  await db.delete(actionRunSchema);
  await db.delete(artifactVersionSchema);
  await db.delete(artifactSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: REQUEST_SCHEMA }).returning({ id: businessObjectTypeSchema.id });
  const [row] = await db.insert(businessObjectSchema).values({
    orgId: ORG,
    typeId: type!.id,
    title: 'Export the ledger as CSV',
    metadata: {
      state: 'triaged',
      priority: 70,
      story: 'Every month end someone at Northwind copies the ledger into a sheet by hand.',
      acceptance: [
        { statement: 'A CSV of the ledger downloads from the ledger page', met: false },
        { statement: 'Existing exports keep working' },
      ],
    },
  }).returning({ id: businessObjectSchema.id });
  requestId = row!.id;
  const [ptype] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'product', label: 'Product', schema: { type: 'object', properties: { notes: { type: 'string' } } } }).returning({ id: businessObjectTypeSchema.id });
  const [prow] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: ptype!.id, title: 'Kestrel Ledger', metadata: { notes: 'The ledger product.' } }).returning({ id: businessObjectSchema.id });
  productId = prow!.id;
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(artifactVersionSchema);
  await db.delete(artifactSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
});

describe('on a record page, the artifact tools land on the record', () => {
  it('read_artifact with no id returns the record\'s body: headmatter, sections, fields', async () => {
    const out = JSON.parse(String(await readArtifactTool(ctxOnPage([])).invoke({})));

    expect(out.record).toEqual({ type: 'request', id: requestId });
    expect(out.md).toContain('priority: 70');
    expect(out.md).toContain('## Acceptance criteria\n\n- [ ] A CSV of the ledger downloads from the ledger page\n- Existing exports keep working');
    expect(out.fields).toMatchObject({ state: 'triaged', priority: 70 });
    expect(out.note).toMatch(/update_artifact/);
  });

  it('update_artifact with edited markdown changes the record: row, version N+1 with who and why, event, Undo', async () => {
    const events: AgentEvent[] = [];
    const read = JSON.parse(String(await readArtifactTool(ctxOnPage([])).invoke({})));
    const md = (read.md as string).replace('- Existing exports keep working', '- Existing PDF exports still download unchanged');

    const out = String(await updateArtifactTool(ctxOnPage(events)).invoke({ content_markdown: md, change_summary: 'Reworded the export criterion as asked', confidence: 0.95 }));

    expect(out).toMatch(/changed — acceptance written \(run #\d+\), now version 2 of its history/);
    expect((await readMeta()).acceptance).toEqual([
      { statement: 'A CSV of the ledger downloads from the ledger page', met: false },
      { statement: 'Existing PDF exports still download unchanged' },
    ]);

    const history = await recordHistory(ORG, requestId);

    expect(history!.versions[0]).toMatchObject({ version: 2, authorKind: 'agent', authorName: 'product-manager', reason: 'Reworded the export criterion as asked' });
    expect(history!.versions[0]!.changes.map(c => c.key)).toEqual(['acceptance']);

    const v = events.find(e => e.type === 'version_written');

    expect(v).toMatchObject({ ref: { type: 'object', id: String(requestId) }, from: 1, to: 2, fields: ['acceptance'] });

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.actionId, 'objects.update_meta'));
    await undoAction(run!.id, ORG, { by: PERSON });

    expect(((await readMeta()).acceptance as Array<{ statement: string }>)[1]!.statement).toBe('Existing exports keep working');
    expect((await recordHistory(ORG, requestId))!.current).toBe(3);
  });

  it('takes spec.record.fields as the whole record', async () => {
    const body = await recordBody(ORG, requestId);
    const fields = { ...((body!.spec as MarkdownSpec).record!.fields as Record<string, unknown>), priority: 91 };
    const out = String(await updateArtifactTool(ctxOnPage([])).invoke({ spec: { record: { fields } }, change_summary: 'Raised priority', confidence: 0.9 }));

    expect(out).toMatch(/priority written/);
    expect((await readMeta()).priority).toBe(91);
  });

  it('a new heading renames the record, and the rename is a version too', async () => {
    const read = JSON.parse(String(await readArtifactTool(ctxOnPage([])).invoke({})));
    const events: AgentEvent[] = [];
    const out = String(await updateArtifactTool(ctxOnPage(events)).invoke({ content_markdown: (read.md as string).replace('# Export the ledger as CSV', '# Export the ledger as a dated CSV'), change_summary: 'Renamed to say what ships', confidence: 0.9 }));

    expect(out).toMatch(/Renamed to "Export the ledger as a dated CSV"/);
    expect(events.find(e => e.type === 'version_written')).toMatchObject({ ref: { type: 'object', id: String(requestId) }, from: 1, to: 2 });

    const [row] = await db.select({ title: businessObjectSchema.title }).from(businessObjectSchema).where(eq(businessObjectSchema.id, requestId));

    expect(row!.title).toBe('Export the ledger as a dated CSV');
    expect((await recordHistory(ORG, requestId))!.versions[0]).toMatchObject({ version: 2, reason: 'Renamed to say what ships' });
  });

  it('refuses a record that is not on the page, of a type the agent was not given — nothing written', async () => {
    const body = await recordBody(ORG, productId);
    const out = String(await updateArtifactTool(ctxOnPage([])).invoke({ id: body!.id, content_markdown: '## Notes\n\nChanged.', change_summary: 'x', confidence: 0.9 }));

    expect(out).toMatch(/^Refused: product #\d+ is not on the person's page/);
    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
    expect(await listArtifactVersions({ orgId: ORG, artifactId: body!.id })).toHaveLength(1);
  });

  it('says so when the body sent back changes nothing', async () => {
    const read = JSON.parse(String(await readArtifactTool(ctxOnPage([])).invoke({})));
    const out = String(await updateArtifactTool(ctxOnPage([])).invoke({ content_markdown: read.md, change_summary: 'nothing', confidence: 0.9 }));

    expect(out).toMatch(/^Nothing changed/);
    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });
});

describe('a person saving the body in the artifact pane is the same record write', () => {
  it('save writes the row through objects.update_meta and returns the new head', async () => {
    const body = await recordBody(ORG, requestId);
    const md = (body!.spec as MarkdownSpec).md.replace('priority: 70', 'priority: 40');
    const res = await saveRecordBodyAsPerson({ orgId: ORG, userId: PERSON, artifact: body!, contentMarkdown: md, changeSummary: 'Lowered it' });

    expect(res.version.version).toBe(2);
    expect((await readMeta()).priority).toBe(40);

    const [run] = await db.select().from(actionRunSchema);

    expect(run).toMatchObject({ actionId: 'objects.update_meta', status: 'done' });
  });

  it('restore from the pane restores the record, as a version of its own', async () => {
    const body = await recordBody(ORG, requestId);
    await saveRecordBodyAsPerson({ orgId: ORG, userId: PERSON, artifact: body!, contentMarkdown: (body!.spec as MarkdownSpec).md.replace('priority: 70', 'priority: 40') });
    const res = await restoreRecordBodyAsPerson({ orgId: ORG, userId: PERSON, artifact: body!, version: 1 });

    expect(res.version.version).toBe(3);
    expect((await readMeta()).priority).toBe(70);
  });

  it('refuses a save that changes nothing', async () => {
    const body = await recordBody(ORG, requestId);

    await expect(saveRecordBodyAsPerson({ orgId: ORG, userId: PERSON, artifact: body!, contentMarkdown: (body!.spec as MarkdownSpec).md })).rejects.toThrow(/Nothing changed/);
  });
});
