/**
 * The body backfill (backlog 035): a dry run counts and writes nothing, an
 * apply creates exactly the missing bodies, a re-run creates none, and a type
 * that opts out is left alone. Every name is fictional.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { artifactSchema, artifactVersionSchema, businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { recordBody } = await import('./recordBody');
const { backfillRecordBodies } = await import('./recordBodyBackfill');

const ORG = 'org_body_backfill';

async function wipe() {
  await db.delete(artifactVersionSchema);
  await db.delete(artifactSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
}

let requestIds: number[] = [];

beforeEach(async () => {
  await wipe();
  const [request] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: { type: 'object', properties: { story: { type: 'string' } } } }).returning({ id: businessObjectTypeSchema.id });
  const [product] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'product', label: 'Product', schema: { type: 'object', properties: { notes: { type: 'string' } } } }).returning({ id: businessObjectTypeSchema.id });
  const [cursor] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'sync_cursor', label: 'Cursor', schema: { 'type': 'object', 'x-record-body': false, 'properties': {} } }).returning({ id: businessObjectTypeSchema.id });
  const rows = await db.insert(businessObjectSchema).values([
    { orgId: ORG, typeId: request!.id, title: 'Export the ledger', metadata: { story: 'Northwind retypes it.' } },
    { orgId: ORG, typeId: request!.id, title: 'Dated filenames', metadata: {} },
    { orgId: ORG, typeId: product!.id, title: 'Kestrel Ledger', metadata: { notes: 'The ledger.' } },
    { orgId: ORG, typeId: cursor!.id, title: 'cursor', metadata: {} },
  ]).returning({ id: businessObjectSchema.id });
  requestIds = rows.slice(0, 2).map(r => r.id);
  // One record already has its body (#815 wrote it on a write).
  await recordBody(ORG, requestIds[0]!);
});

afterAll(wipe);

describe('backfillRecordBodies', () => {
  it('dry run counts what is missing, by type, and writes nothing', async () => {
    const counts = await backfillRecordBodies({ orgId: ORG });

    expect(counts).toEqual({ records: 4, withBody: 1, optedOut: 1, missing: 2, created: 0, failed: 0, byType: { request: 1, product: 1 } });
    expect(await db.select().from(artifactSchema)).toHaveLength(1);
  });

  it('apply creates exactly the missing bodies, and a re-run creates none', async () => {
    const first = await backfillRecordBodies({ orgId: ORG, apply: true });

    expect(first).toMatchObject({ missing: 2, created: 2, failed: 0 });
    expect(await db.select().from(artifactSchema)).toHaveLength(3);

    const again = await backfillRecordBodies({ orgId: ORG, apply: true });

    expect(again).toMatchObject({ withBody: 3, missing: 0, created: 0 });
    expect(await db.select().from(artifactSchema)).toHaveLength(3);
  });
});
