import { describe, expect, it } from 'vitest';
import { listCatalog } from './CatalogService';

/**
 * `/dashboard/marketplace/plugins` is the Plugins tab — a static segment that
 * sits beside the agent profile's `[slug]`. Next.js gives the static segment
 * priority, so a catalog entry slugged `plugins` would have a profile nobody
 * could open. `agents` stays reserved too: it was the tab's URL until the
 * order flipped on 2026-09-20 and somebody may still link it.
 */
describe('catalog slugs vs reserved marketplace segments', () => {
  const RESERVED = ['agents', 'plugins'];

  it('never collides with a static route under /dashboard/marketplace', () => {
    const slugs = listCatalog().map(e => e.slug);

    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.filter(s => RESERVED.includes(s))).toEqual([]);
  });
});
