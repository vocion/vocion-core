import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { safeListApps } = await import('@/libs/workspace/apps');
const { listPlugins } = await import('@/libs/workspace/plugins');
const { getAppOffer, listAppOffers } = await import('./AppCatalogService');

// The Apps page reads the shipped catalogue (templates/apps, templates/plugins)
// against one project's `enabled_plugins`. These read whatever the core ships,
// so they hold as apps and features are added.

const ORG = 'proj-apps';
const apps = safeListApps().filter(a => !a.hidden);
const core = apps.find(a => a.core)!;
// A non-core app with at least one feature, and one of its features.
const other = apps.find(a => !a.core && a.plugins.length > 0)!;
const feature = listPlugins().find(p => p.manifest.slug === other.plugins[0])!;
// A connector some feature of that app reads, when it reads any.
const reads = other.plugins.flatMap(s => listPlugins().find(p => p.manifest.slug === s)?.manifest.recommend.connectors ?? []);

beforeEach(async () => {
  await db.delete(knowledgeSourceSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: 'acct-northwind', name: 'Northwind', slug: 'northwind' });
});

async function project(enabledPlugins: string[]) {
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-northwind', slug: 'northwind', name: 'Northwind', enabledPlugins });
}

describe('listAppOffers', () => {
  it('offers every visible app with a feature, the core app always added', async () => {
    await project([]);
    const offers = await listAppOffers(ORG);

    expect(offers.map(o => o.id)).toContain(core.id);
    expect(offers.map(o => o.id)).toContain(other.id);
    expect(offers.some(o => safeListApps().find(a => a.id === o.id)?.hidden)).toBe(false);
    expect(offers.find(o => o.id === core.id)?.added).toBe(true);
    expect(offers.find(o => o.id === other.id)?.added).toBe(false);
  });

  it('adds an app exactly when one of its features is on, and says which are', async () => {
    await project([feature.manifest.slug]);
    const offer = (await getAppOffer(ORG, other.id))!;

    expect(offer.added).toBe(true);
    expect(offer.features.find(f => f.slug === feature.manifest.slug)?.on).toBe(true);
    expect(offer.features.filter(f => f.slug !== feature.manifest.slug && !feature.manifest.depends.includes(f.slug)).every(f => !f.on)).toBe(true);
  });

  it('names a feature in a person\'s words — its name and one sentence, never a bare slug as the job', async () => {
    await project([]);
    const offer = (await getAppOffer(ORG, other.id))!;
    const f = offer.features.find(x => x.slug === feature.manifest.slug)!;

    expect(f.name).toBe(feature.manifest.name);
    expect(f.job.length).toBeGreaterThan(0);
    expect(f.job).not.toMatch(/\.\s+\p{Lu}/u);
    expect(offer.details.plugins).toContain(feature.manifest.slug);
  });

  it('lists what it brings by name, and each tool it reads with whether it is connected', async () => {
    await project([]);
    if (reads.length > 0) {
      await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: `${reads[0]}-main`, kind: 'plugin', configJson: { _connector: reads[0] } });
    }
    const offer = (await getAppOffer(ORG, other.id))!;

    expect(offer.agents.every(name => name.trim().length > 0)).toBe(true);

    if (reads.length > 0) {
      expect(offer.connectors.find(c => c.slug === reads[0])?.connected).toBe(true);
      expect(offer.connectors.filter(c => c.slug !== reads[0]).every(c => !c.connected)).toBe(true);
    }
  });

  it('knows nothing of an app the catalogue lacks', async () => {
    await project([]);

    await expect(getAppOffer(ORG, 'no-such-app')).resolves.toBeNull();
  });
});
