import { describe, expect, it, vi } from 'vitest';
import { openRecordLabel, recordPreviewParts } from './recordPreview';

vi.mock('@/libs/DB');
vi.mock('@/services/objects/recordHref', () => ({
  recordHref: async (_org: string, ref: { objectType: string | null; id: number }) => (ref.objectType === 'request' ? `/w/northwind/dashboard/p/feature/${ref.id}` : `/w/northwind/dashboard/objects/${ref.id}`),
}));

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
await import('./descriptors');
const { resolvePreview } = await import('./registry');

const ORG = 'org_object_preview';

/** A request type as the software-factory plugin declares it, cut to the fields a preview reads. */
const REQUEST_SCHEMA = {
  type: 'object',
  properties: {
    title: { 'type': 'string', 'x-display': { hidden: true } },
    outcome: { 'type': 'string', 'x-display': { label: 'Outcome', role: 'prose', order: 0 } },
    story: { 'type': 'string', 'x-display': { label: 'The story', role: 'prose', order: 2 } },
    acceptance: { 'type': 'array', 'items': { type: 'object', properties: { statement: { type: 'string' } } }, 'x-display': { label: 'Acceptance criteria', role: 'prose', format: 'steps', order: 5 } },
    state: { 'type': 'string', 'enum': ['new', 'triaged', 'in_scope'], 'x-display': { label: 'State', format: 'badge', group: 'Triage' } },
    product: { type: 'string' },
    estimateCents: { type: 'integer' },
  },
};

const META = {
  title: 'Download CSV of document viewers',
  outcome: 'Allow founders to export every named viewer to a spreadsheet.',
  story: 'As a founder who sent a deck, I want the list of who opened it in my CRM.',
  acceptance: [{ statement: 'A Download CSV button appears beside "Who opened it".' }, { statement: 'The file has one row per named viewer.', met: true }],
  state: 'triaged',
  product: 'northwind-send',
  estimateCents: 400,
};

describe('a record\'s preview reads the record (journey 4, 2026-09-28: "No text was synced" over request #214)', () => {
  it('leads with the type\'s prose fields in order, a list field as a list, and the short facts badges first', () => {
    const parts = recordPreviewParts({ id: 1, title: META.title, status: 'approved', createdAt: null, meta: META }, REQUEST_SCHEMA);

    expect(parts.body).toBe([
      '**Outcome**\n\nAllow founders to export every named viewer to a spreadsheet.',
      '**The story**\n\nAs a founder who sent a deck, I want the list of who opened it in my CRM.',
      '**Acceptance criteria**\n\n- A Download CSV button appears beside "Who opened it".\n- The file has one row per named viewer. — met',
    ].join('\n\n'));
    expect(parts.facts[0]).toEqual({ label: 'State', value: 'triaged' });
    expect(parts.facts).toContainEqual({ label: 'Product', value: 'northwind-send' });
    // Money and ids are the record page's job, not a glance.
    expect(parts.facts.map(f => f.label)).not.toContain('Estimate cents');
  });

  it('reads a type that declares no prose from its long strings', () => {
    const long = 'A paragraph that is plainly words a person reads rather than a short fact, long enough to be one.';
    const parts = recordPreviewParts({ id: 1, title: 'x', status: null, createdAt: null, meta: { note: long } }, { properties: { note: { type: 'string' } } });

    expect(parts.body).toBe(`**Note**\n\n${long}`);
  });

  it('names the page the link opens', () => {
    expect(openRecordLabel('/w/northwind/dashboard/p/feature/214')).toBe('Open feature');
    expect(openRecordLabel('/w/northwind/dashboard/objects/9')).toBe('Open record');
  });

  it('resolves an object ref to its record: title, outcome, story, acceptance, state and "Open feature"', async () => {
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: REQUEST_SCHEMA } as never).returning({ id: businessObjectTypeSchema.id });
    const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: META.title, status: 'approved', metadata: META } as never).returning({ id: businessObjectSchema.id });
    const doc = await resolvePreview({ type: 'object', id: String(row!.id) }, { orgId: ORG, userId: null });

    expect(doc.unresolved).toBeUndefined();
    expect(doc.title).toBe(META.title);
    expect(doc.sourceLabel).toBe('Request');
    expect(doc.body).toContain('**Outcome**');
    expect(doc.body).toContain('**The story**');
    expect(doc.body).toContain('- A Download CSV button appears beside "Who opened it".');
    expect(doc.facts).toEqual(expect.arrayContaining([{ label: 'State', value: 'triaged' }, { label: 'Status', value: 'approved' }]));
    expect(doc.href).toBe(`/w/northwind/dashboard/p/feature/${row!.id}`);
    expect(doc.hrefLabel).toBe('Open feature');
  });
});
