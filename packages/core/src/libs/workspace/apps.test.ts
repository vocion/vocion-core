import { describe, expect, it } from 'vitest';
import { ICONS_BY_NAME } from '@/features/dashboard/iconByName';
import { isSurfaceId } from '@/features/navigation/surfaces';
import { listAppIds, listApps, loadApp } from './apps';
import { listPluginSlugs } from './plugins';
import { AppManifestSchema } from './schemas';

// The shipped app catalogue (templates/apps), read through the real loader so
// a broken app.yaml fails here and not in the sidebar.

describe('the shipped apps', () => {
  it('ships Workforce as the one core app, the four prebuilt apps, and the Assistants slot', () => {
    expect(listAppIds()).toEqual(['assistants', 'company', 'finance', 'gtm', 'software-factory', 'workforce']);
    expect(listApps().filter(a => a.core).map(a => a.id)).toEqual(['workforce']);
    expect(listApps().map(a => a.id)).toEqual(['workforce', 'assistants', 'software-factory', 'gtm', 'company', 'finance']);
  });

  it('starts the Company app on its templates, behind its own plugin', () => {
    const company = loadApp('company');

    expect(company.plugins).toEqual(['company']);
    expect(company.entry).toBe('/dashboard/apps/company');
    expect(company.nav).toEqual(['Company']);
  });

  it('opens the Finance app on its account rules, behind the finance plugin', () => {
    const finance = loadApp('finance');

    expect(finance.plugins).toEqual(['finance']);
    expect(finance.entry).toBe('/dashboard/p/account-rules');
    expect(finance.nav).toEqual(['Finance']);
  });

  it('keeps the Assistants slot hidden until it has plugins of its own', () => {
    const assistants = loadApp('assistants');

    expect(assistants.hidden).toBe(true);
    expect(assistants.plugins).toEqual([]);
  });

  it('names only plugins and surfaces this core ships, and icons the sidebar can draw', () => {
    const plugins = new Set(listPluginSlugs());
    for (const app of listApps()) {
      for (const slug of app.plugins) {
        expect(plugins.has(slug), `${app.id} lists unknown plugin ${slug}`).toBe(true);
      }
      for (const id of app.surfaces) {
        expect(isSurfaceId(id), `${app.id} lists unknown surface ${id}`).toBe(true);
      }

      expect(ICONS_BY_NAME[app.icon], `${app.id} icon ${app.icon}`).toBeDefined();
      expect(app.entry.startsWith('/')).toBe(true);
    }
  });

  it('gives each plugin to at most one app', () => {
    const owners = new Map<string, string>();
    for (const app of listApps()) {
      for (const slug of app.plugins) {
        expect(owners.get(slug), `${slug} is in ${owners.get(slug)} and ${app.id}`).toBeUndefined();

        owners.set(slug, app.id);
      }
    }
  });

  it('refuses an unknown id and names the catalogue', () => {
    expect(() => loadApp('nope')).toThrow(/unknown app "nope" — this core ships: assistants, company, finance, gtm, software-factory, workforce/);
  });
});

describe('AppManifestSchema', () => {
  const minimal = { id: 'sales', name: 'Sales', icon: 'target', description: 'Deals and the documents they need.', entry: '/dashboard/p/deals' };

  it('fills the defaults: not core, not hidden, no plugins, surfaces or sections, ordered last', () => {
    expect(AppManifestSchema.parse(minimal)).toEqual({ ...minimal, order: 100, core: false, hidden: false, plugins: [], surfaces: [], nav: [] });
  });

  it('refuses a core app that lists plugins — it keeps every row no other app claims', () => {
    expect(AppManifestSchema.safeParse({ ...minimal, core: true, plugins: ['deals'] }).success).toBe(false);
  });

  it('refuses an entry that is not a path, and an id that is not a slug', () => {
    expect(AppManifestSchema.safeParse({ ...minimal, entry: 'deals' }).success).toBe(false);
    expect(AppManifestSchema.safeParse({ ...minimal, id: 'Sales App' }).success).toBe(false);
  });
});
