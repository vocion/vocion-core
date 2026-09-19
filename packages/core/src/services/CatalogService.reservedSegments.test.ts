import { describe, expect, it } from 'vitest';
import { listCatalog } from './CatalogService';

/**
 * `/dashboard/marketplace/agents` is the Agents-for-hire tab — a static
 * segment that sits beside the agent profile's `[slug]`. Next.js gives the
 * static segment priority, so a catalog entry slugged `agents` would have a
 * profile nobody could open. Nothing stops somebody adding that file; this
 * does.
 */
describe('catalog slugs vs reserved marketplace segments', () => {
  const RESERVED = ['agents'];

  it('never collides with a static route under /dashboard/marketplace', () => {
    const slugs = listCatalog().map(e => e.slug);

    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.filter(s => RESERVED.includes(s))).toEqual([]);
  });
});
