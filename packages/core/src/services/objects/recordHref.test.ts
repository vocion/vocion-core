import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { readWorkspacePages } = await import('@/libs/workspace/pages');
const { recordHref, recordLinkerForOrg } = await import('./recordHref');

const ORG = 'proj_record_href';
const saved = process.env.WORKSPACE_PATH;

beforeAll(async () => {
  delete process.env.WORKSPACE_PATH;
  await db.insert(tenantAccountSchema).values({ id: 'acct-record-href', name: 'Northwind', slug: 'northwind-links' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-record-href', slug: 'northwind-factory', name: 'Northwind Factory', enabledPlugins: ['software-factory'] });
});

afterAll(() => {
  if (saved !== undefined) {
    process.env.WORKSPACE_PATH = saved;
  }
});

describe('recordHref (server)', () => {
  it('reads the org\'s plugins and slug: a release opens its release page, in the workspace', async () => {
    expect(await recordHref(ORG, { objectType: 'release', id: 12 })).toBe('/w/northwind-factory/dashboard/p/releases/12');
    expect(await recordHref(ORG, { objectType: 'engineering_task', id: 52 })).toBe('/w/northwind-factory/dashboard/objects/52');

    const link = await recordLinkerForOrg(ORG);

    expect(link({ objectType: 'request', id: 41 })).toBe('/w/northwind-factory/dashboard/p/feature/41');
  });

  it('takes manifests in place of an org, and leaves the link bare', async () => {
    const pages = readWorkspacePages({ enabledPlugins: ['software-factory'], mounted: false }).pages;

    expect(await recordHref(pages, { objectType: 'product', id: 3 })).toBe('/dashboard/p/products/3');
    expect(await recordHref([], { objectType: 'product', id: 3 })).toBe('/dashboard/objects/3');
  });

  it('opens every record generically for an org with no plugins', async () => {
    expect(await recordHref('proj_missing', { objectType: 'release', id: 12 })).toBe('/dashboard/objects/12');
  });
});
