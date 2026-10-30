/**
 * The candidate-queue reads and the external link — the two pieces an admin
 * panel drives. The paging test matters most: a moderation queue that filtered
 * or counted in the application would fall over on the first busy source.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const ORG = 'org_objects_service';
const OTHER_ORG = 'org_elsewhere';

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { groupRecordsByType, linkExternalRecord, listBusinessObjectPage, listBusinessObjectsForProject } = await import('./BusinessObjectService');
const { eq } = await import('drizzle-orm');

/** Type ids, filled by the seed so each test can attach objects to a type. */
const typeIds: Record<string, number> = {};

async function seedTypes() {
  for (const [slug, label] of [['event_candidate', 'Event candidate'], ['grant_deadline', 'Grant deadline'], ['seo_page', 'SEO page']]) {
    const [row] = await db
      .insert(businessObjectTypeSchema)
      .values({ orgId: ORG, slug: slug!, label: label! })
      .returning({ id: businessObjectTypeSchema.id });
    typeIds[slug!] = row!.id;
  }
  const [other] = await db
    .insert(businessObjectTypeSchema)
    .values({ orgId: OTHER_ORG, slug: 'event_candidate', label: 'Event candidate' })
    .returning({ id: businessObjectTypeSchema.id });
  typeIds.other = other!.id;
}

type SeedObject = {
  title: string;
  typeSlug?: string;
  status?: string;
  orgId?: string;
  externalSystem?: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
};

async function seedObject(object: SeedObject): Promise<number> {
  const typeId = object.orgId === OTHER_ORG ? typeIds.other! : typeIds[object.typeSlug ?? 'event_candidate']!;
  const [row] = await db
    .insert(businessObjectSchema)
    .values({
      orgId: object.orgId ?? ORG,
      typeId,
      title: object.title,
      status: object.status ?? 'candidate',
      externalSystem: object.externalSystem,
      externalId: object.externalId,
      ...(object.metadata ? { metadata: object.metadata } : {}),
    })
    .returning({ id: businessObjectSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await seedTypes();
});

afterAll(async () => {
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
});

describe('listBusinessObjectPage', () => {
  it('returns this org\'s objects only, with the type spelled out', async () => {
    await seedObject({ title: 'Open Mic Night' });
    await seedObject({ title: 'Someone else\'s event', orgId: OTHER_ORG });

    const page = await listBusinessObjectPage(ORG);

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      title: 'Open Mic Night',
      typeSlug: 'event_candidate',
      typeLabel: 'Event candidate',
      status: 'candidate',
      metadata: {},
    });
  });

  it('filters by object type', async () => {
    await seedObject({ title: 'Open Mic Night' });
    await seedObject({ title: 'NEA Folk Arts', typeSlug: 'grant_deadline' });

    const page = await listBusinessObjectPage(ORG, { typeSlug: 'grant_deadline' });

    expect(page.total).toBe(1);
    expect(page.items[0]?.title).toBe('NEA Folk Arts');
  });

  it('filters by lifecycle state', async () => {
    await seedObject({ title: 'Waiting' });
    await seedObject({ title: 'Decided', status: 'approved' });

    const page = await listBusinessObjectPage(ORG, { status: 'approved' });

    expect(page.total).toBe(1);
    expect(page.items[0]?.title).toBe('Decided');
  });

  it('splits linked from unlinked, which is the "published yet?" question', async () => {
    await seedObject({ title: 'Published', status: 'approved', externalSystem: 'strapi', externalId: '412' });
    await seedObject({ title: 'Approved, not published', status: 'approved' });

    const linked = await listBusinessObjectPage(ORG, { linked: true });
    const unlinked = await listBusinessObjectPage(ORG, { linked: false });
    const both = await listBusinessObjectPage(ORG, {});

    expect(linked.items.map(item => item.title)).toEqual(['Published']);
    expect(unlinked.items.map(item => item.title)).toEqual(['Approved, not published']);
    expect(both.total).toBe(2);
  });

  it('searches the title without minding case', async () => {
    await seedObject({ title: 'Open Mic Night' });
    await seedObject({ title: 'Poetry Slam' });

    const page = await listBusinessObjectPage(ORG, { search: 'open mic' });

    expect(page.items.map(item => item.title)).toEqual(['Open Mic Night']);
  });

  it('pages with a real total, and never repeats a row across pages', async () => {
    for (let n = 1; n <= 5; n++) {
      await seedObject({ title: `Candidate ${n}` });
    }

    const first = await listBusinessObjectPage(ORG, { limit: 2, offset: 0 });
    const second = await listBusinessObjectPage(ORG, { limit: 2, offset: 2 });
    const third = await listBusinessObjectPage(ORG, { limit: 2, offset: 4 });

    // The total is the whole match, not the page.
    expect(first.total).toBe(5);
    expect(first.items).toHaveLength(2);
    expect(third.items).toHaveLength(1);

    const seen = [...first.items, ...second.items, ...third.items].map(item => item.id);

    expect(new Set(seen).size).toBe(5);
  });

  it('orders newest first, tie-broken by id so paging is stable', async () => {
    // Same createdAt to the millisecond is the case a sort without a
    // tie-break gets wrong, and it is exactly what a bulk scrape produces.
    const ids = [
      await seedObject({ title: 'A' }),
      await seedObject({ title: 'B' }),
      await seedObject({ title: 'C' }),
    ];

    const page = await listBusinessObjectPage(ORG);

    expect(page.items.map(item => item.id)).toEqual([...ids].reverse());
  });

  it('clamps a silly page size instead of trusting the caller', async () => {
    await seedObject({ title: 'Only one' });

    const huge = await listBusinessObjectPage(ORG, { limit: 100000 });
    const zero = await listBusinessObjectPage(ORG, { limit: 0, offset: -5 });

    expect(huge.limit).toBe(200);
    expect(zero.limit).toBe(1);
    expect(zero.offset).toBe(0);
  });

  it('is empty, not broken, when nothing matches', async () => {
    const page = await listBusinessObjectPage(ORG, { typeSlug: 'grant_deadline' });

    expect(page).toMatchObject({ items: [], total: 0 });
  });
});

describe('linkExternalRecord', () => {
  it('points an object at the record another system published', async () => {
    const id = await seedObject({ title: 'Open Mic Night', status: 'approved' });

    const linked = await linkExternalRecord(ORG, id, { system: 'strapi', id: '412' });

    expect(linked).toMatchObject({ externalSystem: 'strapi', externalId: '412' });

    const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));

    expect(row!.externalId).toBe('412');
  });

  it('is idempotent, so a retried link-back is harmless', async () => {
    const id = await seedObject({ title: 'Open Mic Night', status: 'approved' });

    await linkExternalRecord(ORG, id, { system: 'strapi', id: '412' });
    const again = await linkExternalRecord(ORG, id, { system: 'strapi', id: '412' });

    expect(again).toMatchObject({ externalSystem: 'strapi', externalId: '412' });
  });

  it('refuses to link an object belonging to another org', async () => {
    const theirs = await seedObject({ title: 'Theirs', orgId: OTHER_ORG });

    const linked = await linkExternalRecord(ORG, theirs, { system: 'strapi', id: '412' });

    expect(linked).toBeNull();

    const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, theirs));

    expect(row!.externalId).toBeNull();
  });

  it('returns null for an id that does not exist', async () => {
    expect(await linkExternalRecord(ORG, 987654, { system: 'strapi', id: '1' })).toBeNull();
  });

  it('will not let two objects claim the same published record', async () => {
    const first = await seedObject({ title: 'First', status: 'approved' });
    const second = await seedObject({ title: 'Second', status: 'approved' });
    await linkExternalRecord(ORG, first, { system: 'strapi', id: '412' });

    // The unique index is the guard: one business object per external record.
    await expect(linkExternalRecord(ORG, second, { system: 'strapi', id: '412' })).rejects.toThrow();
  });
});

describe('records that belong to a project (`metadata.projectId`)', () => {
  it('lists any type that names the project, in this org only, whether the id was stored as a number or a string', async () => {
    const project = await seedObject({ title: 'Northwind Outfitters', status: 'active' });
    await seedObject({ title: 'Open Mic Night', metadata: { projectId: project } });
    await seedObject({ title: 'NEA Folk Arts', typeSlug: 'grant_deadline', metadata: { projectId: String(project) } });
    await seedObject({ title: 'Another client\'s page', metadata: { projectId: project + 1000 } });
    await seedObject({ title: 'No project at all' });
    await seedObject({ title: 'Someone else\'s', orgId: OTHER_ORG, metadata: { projectId: project } });

    const records = await listBusinessObjectsForProject(ORG, project);

    expect(records.map(r => r.title).sort()).toEqual(['NEA Folk Arts', 'Open Mic Night']);
    expect(records.find(r => r.title === 'NEA Folk Arts')).toMatchObject({ typeSlug: 'grant_deadline', typeLabel: 'Grant deadline' });

    const page = await listBusinessObjectPage(ORG, { projectId: project, typeSlug: 'event_candidate' });

    expect(page.items.map(i => i.title)).toEqual(['Open Mic Night']);
  });

  it('shows SEO editorial lifecycle while retaining generic status for other records and legacy pages', async () => {
    const project = await seedObject({ title: 'Client project', status: 'active' });
    await seedObject({ title: 'Review draft', typeSlug: 'seo_page', status: 'active', metadata: { projectId: project, status: 'in_review' } });
    await seedObject({ title: 'Revise draft', typeSlug: 'seo_page', status: 'active', metadata: { projectId: project, status: 'changes_requested' } });
    await seedObject({ title: 'Legacy page', typeSlug: 'seo_page', status: 'active', metadata: { projectId: project } });
    await seedObject({ title: 'Generic record', status: 'active', metadata: { projectId: project, status: 'in_review' } });

    const records = await listBusinessObjectsForProject(ORG, project);

    expect(records.find(r => r.title === 'Review draft')?.status).toBe('in_review');
    expect(records.find(r => r.title === 'Revise draft')?.status).toBe('changes_requested');
    expect(records.find(r => r.title === 'Legacy page')?.status).toBe('active');
    expect(records.find(r => r.title === 'Generic record')?.status).toBe('active');
  });

  it('groups by type label, the type with the newest record first', () => {
    const groups = groupRecordsByType([
      { id: 3, typeLabel: 'SEO page' },
      { id: 2, typeLabel: 'SEO batch' },
      { id: 1, typeLabel: 'SEO page' },
    ]);

    expect(groups.map(g => [g.label, g.records.map(r => r.id)])).toEqual([['SEO page', [3, 1]], ['SEO batch', [2]]]);
  });
});
