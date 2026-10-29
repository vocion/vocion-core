/**
 * Which app a chat turn is said in, and who leads it (2026-10-29). Fictional
 * fixtures: Fernhill, an agency with an SEO app beside the core one.
 */
import type { AppDefinition } from '@/features/navigation/apps';
import { describe, expect, it } from 'vitest';
import { cookieValue, resolveAppScope } from './appScope';

const app = (over: Partial<AppDefinition> & Pick<AppDefinition, 'id'>): AppDefinition => ({ name: over.id, icon: 'box', order: 1, core: false, hidden: false, plugins: [], surfaces: [], entry: `/dashboard/p/${over.id}`, nav: [], ...over });
const APPS = [app({ id: 'workforce', core: true, entry: '/dashboard/chat' }), app({ id: 'seo', name: 'Search Engine Optimization', shortName: 'SEO', plugins: ['seo'] }), app({ id: 'ads', plugins: ['ads'] })];
const TEAMS = [{ slug: 'ads', app: null, lead: 'ads-manager' }, { slug: 'seo', app: null, lead: 'seo-strategist' }];
const AGENTS = [
  { slug: 'workspace-lead', active: 'true', teamSlug: null },
  { slug: 'seo-strategist', active: 'true', teamSlug: 'seo' },
  { slug: 'serp-analyst', active: 'true', teamSlug: 'seo' },
  { slug: 'ads-manager', active: 'true', teamSlug: 'ads' },
];
const base = { apps: APPS, enabledPlugins: ['seo', 'ads'], enabledSurfaces: [], teams: TEAMS, pluginTeams: { seo: ['seo'], ads: ['ads'] }, agents: AGENTS };

describe('the app a chat turn is said in', () => {
  it('names the app\'s teams and lead, and the seeded lead outside it: the reference case', () => {
    expect(resolveAppScope({ ...base, appId: 'seo', projectLead: 'seo-strategist' })).toEqual({ id: 'seo', name: 'SEO', teams: ['seo'], leadSlug: 'seo-strategist', outsideSlug: 'workspace-lead' });
  });

  it('takes the workspace\'s lead as the outside lead when it is not one of the app\'s seats', () => {
    expect(resolveAppScope({ ...base, appId: 'seo', projectLead: 'ads-manager' })).toMatchObject({ leadSlug: 'seo-strategist', outsideSlug: 'ads-manager' });
  });

  it('is no app for the core app, an app not installed here, or no cookie', () => {
    expect(resolveAppScope({ ...base, appId: 'workforce', projectLead: null })).toBeNull();
    expect(resolveAppScope({ ...base, appId: 'seo', enabledPlugins: ['ads'], projectLead: null })).toBeNull();
    expect(resolveAppScope({ ...base, appId: null, projectLead: null })).toBeNull();
  });

  it('is no app when none of its teams has an active lead', () => {
    expect(resolveAppScope({ ...base, appId: 'seo', projectLead: null, agents: AGENTS.map(a => (a.slug === 'seo-strategist' ? { ...a, active: 'false' } : a)) })).toBeNull();
  });

  it('reads one cookie from the header', () => {
    expect(cookieValue('a=1; vocion_nav_app=fernhill%3Aseo; b=2', 'vocion_nav_app')).toBe('fernhill%3Aseo');
    expect(cookieValue(null, 'vocion_nav_app')).toBeNull();
  });
});
