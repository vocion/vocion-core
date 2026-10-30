/**
 * A Webflow target learned from the site's own blog, against Webflow's
 * recorded answers: a suggestion on the project, never its targets.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_BLOG_ID, FIXTURE_SITE_ID, FIXTURE_WEBFLOW_TOKEN, webflowFetch } from '@/libs/fixtures/webflow';
import { webflowClient } from '@/libs/webflow/api';

let meta: Record<string, unknown> = {};
const updateDataRoom = vi.fn(async (_org: string, _id: number, patch: Record<string, unknown>) => {
  meta = { ...meta, ...patch };
  return { meta };
});
vi.mock('@/services/DataRoomService', () => ({
  getDataRoom: vi.fn(async (_org: string, id: number) => (id === 10 ? { id: 10, meta } : null)),
  updateDataRoom,
}));

const { suggestWebflowTarget } = await import('./learnWebflow');

beforeEach(() => {
  meta = {};
  updateDataRoom.mockClear();
  vi.stubGlobal('fetch', vi.fn(webflowFetch().fetch));
});

describe('learning a Webflow target', () => {
  it('finds the site by its domain and its blog by name, maps the fields, and keeps it as a suggestion for a person', async () => {
    const out = await suggestWebflowTarget('org_nw', 10, { site: 'northwind-outfitters.example', by: 'agent:seo-strategist' }, webflowClient(FIXTURE_WEBFLOW_TOKEN));

    expect(out.ok).toBe(true);
    expect(out.ok && out.suggestion).toMatchObject({
      replaces: null,
      from: 'Blog Posts on Northwind Outfitters',
      read: ['Layering for Shoulder Season'],
      target: {
        id: 'site',
        kind: 'webflow',
        config: {
          siteId: FIXTURE_SITE_ID,
          siteUrl: 'https://www.northwind-outfitters.example',
          collectionId: FIXTURE_BLOG_ID,
          collectionPath: '/blog',
          fields: { body: 'post-body', excerpt: 'post-summary', metaTitle: 'seo-title', metaDescription: 'meta-description', author: 'author', date: 'publish-date', image: 'main-image', category: 'category' },
        },
      },
    });
    expect(out.ok && out.line).toContain('body → post-body');
    // Only the suggestion is written: the targets are a person's.
    expect(updateDataRoom).toHaveBeenCalledTimes(1);
    expect(Object.keys(updateDataRoom.mock.calls[0]![2])).toEqual(['publishTargetSuggestion']);
  });

  it('fills in the project\'s own Webflow target, keeping its id, label and address', async () => {
    meta = { publishTargets: [{ id: 'blog', kind: 'webflow', label: 'Northwind blog', config: { siteUrl: 'https://www.northwind-outfitters.example' } }] };
    const out = await suggestWebflowTarget('org_nw', 10, { by: 'usr-jamie' }, webflowClient(FIXTURE_WEBFLOW_TOKEN));

    expect(out.ok && out.suggestion).toMatchObject({ replaces: 'blog', target: { id: 'blog', label: 'Northwind blog', config: { siteId: FIXTURE_SITE_ID, collectionId: FIXTURE_BLOG_ID } } });
  });

  it('says which sites the login reaches when it does not reach the one named', async () => {
    const out = await suggestWebflowTarget('org_nw', 10, { site: 'https://another-client.example', by: null }, webflowClient(FIXTURE_WEBFLOW_TOKEN));

    expect(out).toEqual({ ok: false, why: 'The Webflow login does not reach https://another-client.example (it reaches Northwind Outfitters): log in with Webflow again and pick that site.' });
    expect(updateDataRoom).not.toHaveBeenCalled();
  });
});
