import { describe, expect, it } from 'vitest';
import { objectCollection } from './objectCollection';
import { readWorkspacePages } from './pages';

describe('object collection navigation', () => {
  it('returns to the real SEO Pages list in the owning workspace', () => {
    const { pages } = readWorkspacePages({ enabledPlugins: ['seo'], mounted: false });

    expect(objectCollection(pages, 'seo_page', 'northwind')).toEqual({ label: 'Pages', href: '/w/northwind/dashboard/p/seo-pages' });
    expect(objectCollection(pages, 'unknown', 'northwind')).toEqual({ label: 'Objects', href: '/w/northwind/dashboard/objects' });
  });

  it('honors a workspace replacement without accepting an arbitrary return URL', () => {
    const pages = [{ slug: 'editorial', title: 'Editorial queue', archetype: 'list', source: { kind: 'objects', objectType: 'seo_page' } }];

    expect(objectCollection(pages as never, 'seo_page', 'acme')).toEqual({ label: 'Editorial queue', href: '/w/acme/dashboard/p/editorial' });
  });
});
