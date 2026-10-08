import process from 'node:process';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `app.install` — adding an app from a setup card. An app is the plugins it
 * is made of, so adding one turns them on in one write, and Undo puts the list
 * back exactly as it was. The refusals are what keep a card from being drawn
 * that could only fail: an app this core does not ship, the core app, an app
 * already here.
 */

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
// `@/routers/Workspace` (the folder resolver) imports AuthGuards, which pulls
// in next-auth — a factory, as in plugin-enable.test.ts.
vi.mock('@/routers/AuthGuards', () => ({ guardAuth: vi.fn(), guardRole: vi.fn(), loadProject: vi.fn() }));

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { appInstallAction } = await import('./app-install');
const { safeListApps } = await import('@/libs/workspace/apps');

const SUPPORT = 'proj-app-support';
const NEIGHBOUR = 'proj-app-neighbour';
const ctx = { orgId: SUPPORT, invokedBy: 'usr-app-dana' };

/** An app this core ships that is made of plugins. */
const app = safeListApps().find(a => !a.core && !a.hidden && a.plugins.length > 0)!;

async function pluginsOf(orgId: string): Promise<string[]> {
  const [row] = await db.select({ p: projectSchema.enabledPlugins }).from(projectSchema).where(eq(projectSchema.id, orgId));
  return row?.p ?? [];
}

beforeAll(async () => {
  delete process.env.WORKSPACE_PATH;
  delete process.env.VOCION_WORKSPACE_MAP;
  await db.insert(tenantAccountSchema).values({ id: 'acct-app', name: 'Northwind', slug: 'northwind-app' });
  await db.insert(projectSchema).values([
    { id: SUPPORT, accountId: 'acct-app', slug: 'support', name: 'Northwind Support' },
    { id: NEIGHBOUR, accountId: 'acct-app', slug: 'neighbour', name: 'Northwind Delivery' },
  ]);
});

beforeEach(async () => {
  await db.update(projectSchema).set({ enabledPlugins: [] });
});

describe('app.install', () => {
  it('refuses what could only fail, before a card is drawn', async () => {
    expect(await appInstallAction.precheck!(ctx, { app: 'no-such-app' })).toContain('no app "no-such-app"');

    const core = safeListApps().find(a => a.core)!;

    expect(await appInstallAction.precheck!(ctx, { app: core.id })).toContain('part of every workspace');

    await db.update(projectSchema).set({ enabledPlugins: app.plugins }).where(eq(projectSchema.id, SUPPORT));

    expect(await appInstallAction.precheck!(ctx, { app: app.id })).toContain('already in this workspace');
  });

  it('turns on every plugin the app is made of, here and nowhere else, and Undo puts the list back', async () => {
    await db.update(projectSchema).set({ enabledPlugins: ['wiki'] }).where(eq(projectSchema.id, SUPPORT));

    expect(await appInstallAction.precheck!(ctx, { app: app.id })).toBeUndefined();

    const result = await appInstallAction.execute(ctx, { app: app.id });

    expect(result).toMatchObject({ added: true, app: app.id, before: ['wiki'], mode: 'project' });

    for (const plugin of app.plugins) {
      expect(await pluginsOf(SUPPORT)).toContain(plugin);
    }

    expect(await pluginsOf(SUPPORT)).toContain('wiki');
    expect(await pluginsOf(NEIGHBOUR)).toEqual([]);

    await appInstallAction.undo!(ctx, { app: app.id }, result);

    expect(await pluginsOf(SUPPORT)).toEqual(['wiki']);
  });

  it('reads as a decision a person can make on the queue too', async () => {
    const card = await appInstallAction.reviewCard!(ctx, { app: app.id });

    expect(card.title).toBe(`Add ${app.name}`);
    expect(card.verbs?.approve).toBe('Add');
    expect(card.badges).toEqual([{ label: 'Reversible' }]);
  });
});
