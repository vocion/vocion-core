/**
 * objects.create_group — a parent record and its children, created in one
 * tap or not at all. The fixtures use the software-factory's product and repo
 * shapes because they are the first caller; the action itself names neither.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { forgetCachedObjectTypes } = await import('./objects-propose-candidate');
const { objectsCreateGroupAction } = await import('./objects-create-group');
const { bindingProblem } = await import('./bindable');
const { isNeverAuto } = await import('./neverAuto');
const { eq } = await import('drizzle-orm');

const ORG = 'org_create_group';
const CTX = { orgId: ORG, invokedBy: 'user_ada', reviewedBy: 'user_ada' };

const PRODUCT_SCHEMA = {
  'type': 'object',
  'x-agent-file': { dedupOn: ['slug'] },
  'properties': { slug: { type: 'string' }, name: { type: 'string' } },
};
const REPO_SCHEMA = {
  'type': 'object',
  'x-agent-file': { dedupOn: ['slug'] },
  'properties': { slug: { type: 'string' }, url: { type: 'string' }, product: { type: 'string' } },
};

function groupInput(over: Record<string, unknown> = {}) {
  return objectsCreateGroupAction.inputSchema.parse({
    parent: { type: 'product', title: 'Northwind Portal', fields: { slug: 'northwind-portal', name: 'Northwind Portal' } },
    children: [
      { type: 'repo', title: 'northwind/portal', fields: { slug: 'northwind-portal-web', url: 'https://github.com/northwind/portal' } },
      { type: 'repo', title: 'northwind/portal-api', fields: { slug: 'northwind-portal-api', url: 'https://github.com/northwind/portal-api' } },
    ],
    link: { childField: 'product', parentField: 'slug' },
    ...over,
  });
}

async function seedTypes(withRepo = true) {
  forgetCachedObjectTypes();
  await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'product', label: 'Product', schema: PRODUCT_SCHEMA });
  if (withRepo) {
    await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'repo', label: 'Repository', schema: REPO_SCHEMA });
  }
}

async function records() {
  return db.select().from(businessObjectSchema).where(eq(businessObjectSchema.orgId, ORG));
}

type Tx = { insert: (table: unknown) => unknown };

/**
 * Make the nth insert inside the next transaction throw, so a group fails midway.
 * @param nth - Which insert fails, counting from one.
 */
function failNthInsert(nth: number) {
  const realTransaction = db.transaction.bind(db) as (run: (tx: Tx) => Promise<unknown>) => Promise<unknown>;
  vi.spyOn(db, 'transaction').mockImplementation(((run: (tx: Tx) => Promise<unknown>) => realTransaction(tx => runWithFailingInsert(tx, run, nth))) as never);
}

async function runWithFailingInsert(tx: Tx, run: (tx: Tx) => Promise<unknown>, nth: number) {
  const realInsert = tx.insert.bind(tx);
  const counter = { inserts: 0 };
  tx.insert = (table: unknown) => failingInsert(realInsert, counter, nth, table);
  return run(tx);
}

function failingInsert(realInsert: (table: unknown) => unknown, counter: { inserts: number }, nth: number, table: unknown) {
  counter.inserts += 1;
  if (counter.inserts === nth) {
    throw new Error('disk full');
  }
  return realInsert(table);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  forgetCachedObjectTypes();
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
});

afterAll(async () => {
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
});

describe('objects.create_group', () => {
  it('finds the matching record among many unrelated ones of the same type', async () => {
    await seedTypes();
    const [productType] = await db.select().from(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.slug, 'product'));
    const unrelated = Array.from({ length: 50 }, (_, index) => ({ orgId: ORG, typeId: productType!.id, title: `Other ${index}`, status: 'active', metadata: { slug: `other-${index}` } }));
    await db.insert(businessObjectSchema).values(unrelated);
    const [match] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: productType!.id, title: 'Portal', status: 'active', metadata: { slug: 'Northwind Portal' } }).returning();

    const result = await objectsCreateGroupAction.execute(CTX, groupInput({ children: [] })) as { parent: { id: number; created: boolean } };

    expect(result.parent).toEqual({ id: match!.id, created: false });
    expect(await records()).toHaveLength(51);
  });

  it('is held for a person on the trust ladder, like other record-creating actions', () => {
    expect(isNeverAuto(objectsCreateGroupAction)).toBe(true);
  });

  it('creates a parent and two children, each child carrying the parent link, active', async () => {
    await seedTypes();
    const result = await objectsCreateGroupAction.execute(CTX, groupInput()) as { parent: { created: boolean }; children: Array<{ created: boolean }> };

    const rows = await records();

    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.status === 'active')).toBe(true);

    const repos = rows.filter(row => row.metadata?.url);

    expect(repos.map(row => row.metadata?.product)).toEqual(['northwind-portal', 'northwind-portal']);
    expect(result.parent.created).toBe(true);
    expect(result.children.map(child => child.created)).toEqual([true, true]);
  });

  it('approving twice creates nothing the second time and says so for every record', async () => {
    await seedTypes();
    await objectsCreateGroupAction.execute(CTX, groupInput());
    const again = await objectsCreateGroupAction.execute(CTX, groupInput()) as { parent: { created: boolean }; children: Array<{ created: boolean }> };

    expect(await records()).toHaveLength(3);
    expect([again.parent.created, ...again.children.map(child => child.created)]).toEqual([false, false, false]);
  });

  it('reuses an existing parent and creates only the missing children', async () => {
    await seedTypes();
    const [productType] = await db.select().from(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.slug, 'product'));
    const [existing] = await db.insert(businessObjectSchema).values({
      orgId: ORG,
      typeId: productType!.id,
      title: 'Northwind Portal (old name)',
      status: 'active',
      metadata: { slug: 'northwind-portal' },
    }).returning();

    const result = await objectsCreateGroupAction.execute(CTX, groupInput()) as { parent: { id: number; created: boolean }; children: Array<{ created: boolean }> };

    expect(result.parent).toEqual({ id: existing!.id, created: false });
    expect(result.children.map(child => child.created)).toEqual([true, true]);
    expect(await records()).toHaveLength(3);
  });

  it('refuses before writing when a type is missing, and leaves nothing behind when a write fails midway', async () => {
    await seedTypes(false);
    const refusal = await objectsCreateGroupAction.precheck!(CTX, groupInput());

    expect(refusal).toMatch(/repo/);

    await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'repo', label: 'Repository', schema: REPO_SCHEMA });
    forgetCachedObjectTypes();

    expect(await objectsCreateGroupAction.precheck!(CTX, groupInput())).toBeUndefined();

    failNthInsert(3);

    await expect(objectsCreateGroupAction.execute(CTX, groupInput())).rejects.toThrow('disk full');
    expect(await records()).toHaveLength(0);
  });

  describe('validating what it creates', () => {
    async function seedStrictTypes() {
      forgetCachedObjectTypes();
      await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'product', label: 'Product', schema: { ...PRODUCT_SCHEMA, required: ['name'] } });
      await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'repo', label: 'Repository', schema: { ...REPO_SCHEMA, required: ['url'] } });
    }

    it('refuses a child missing a required field, names the field, and creates nothing', async () => {
      await seedStrictTypes();
      const input = groupInput({ children: [
        { type: 'repo', title: 'northwind/portal', fields: { slug: 'northwind-portal-web', url: 'https://github.com/northwind/portal' } },
        { type: 'repo', title: 'northwind/portal-api', fields: { slug: 'northwind-portal-api' } },
      ] });
      const refusal = await objectsCreateGroupAction.precheck!(CTX, input);

      expect(refusal).toMatch(/northwind\/portal-api/);
      expect(refusal).toMatch(/url/);

      await expect(objectsCreateGroupAction.execute(CTX, input)).rejects.toThrow(/url/);
      expect(await records()).toHaveLength(0);
    });

    it('refuses a parent missing a required field', async () => {
      await seedStrictTypes();
      const refusal = await objectsCreateGroupAction.precheck!(CTX, groupInput({ parent: { type: 'product', title: 'Northwind Portal', fields: { slug: 'northwind-portal' } } }));

      expect(refusal).toMatch(/Northwind Portal/);
      expect(refusal).toMatch(/name/);
    });

    it('a valid group passes the check and lands in one transaction', async () => {
      await seedStrictTypes();
      const input = groupInput({ children: [
        { type: 'repo', title: 'northwind/portal', fields: { slug: 'northwind-portal-web', url: 'https://github.com/northwind/portal' } },
      ] });

      expect(await objectsCreateGroupAction.precheck!(CTX, input)).toBeUndefined();

      await objectsCreateGroupAction.execute(CTX, input);

      expect(await records()).toHaveLength(2);
    });
  });

  it('names no record type in its own source, so the plugin boundary holds', () => {
    const source = readFileSync(new URL('./objects-create-group.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/'product'|'repo'/);
  });

  it('can ride on a choice option, because it changes nothing outside Vocion', () => {
    expect(bindingProblem('objects.create_group')).toBeNull();
  });

  it('undo deletes what the run created and keeps what already existed', async () => {
    await seedTypes();
    await objectsCreateGroupAction.execute(CTX, groupInput({ children: [groupInput().children[0]] }));
    const second = await objectsCreateGroupAction.execute(CTX, groupInput()) as Record<string, unknown>;

    await objectsCreateGroupAction.undo!(CTX, groupInput(), second);

    const left = await records();

    expect(left).toHaveLength(2);
  });
});
