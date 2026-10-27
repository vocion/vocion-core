/**
 * The plan's refusal, as a pure rule: two pages never compete for one keyword
 * or one URL unless the plan says the new one is a refresh.
 */
import type { SeoPageRecord } from './records';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/BusinessObjectService', () => ({}));
vi.mock('./projects', () => ({}));

const { pathKey, planConflicts, targetOf } = await import('./records');

function page(id: number, batchId: number, keyword: string, more: Partial<SeoPageRecord['meta']> = {}): SeoPageRecord {
  return { id, title: keyword, meta: { projectId: 7, batchId, order: id, keyword, status: 'proposed', ...more } };
}

const EXISTING = [
  page(11, 1, 'Water heater repair Fairview'),
  page(12, 2, 'drain cleaning lakeside', { status: 'published', publishedUrl: 'https://northwind-home.example/lakeside/drain-cleaning/' }),
  page(13, 2, 'sump pump repair', { status: 'approved' }),
  page(14, 1, 'tankless water heaters', { status: 'rejected' }),
  page(15, 2, 'boiler service', { existingUrl: 'https://northwind-home.example/boilers' }),
];
const OPEN = new Set([1]);

describe('planConflicts', () => {
  it('refuses a keyword already planned in another open batch, whatever its spelling', () => {
    expect(planConflicts([{ keyword: 'water heater repair, fairview' }], EXISTING, OPEN)).toEqual([
      expect.stringMatching(/^"water heater repair, fairview" is already page #11 \(planned in batch #1\)/),
    ]);
  });

  it('refuses a keyword a published page already targets, even from a closed batch', () => {
    expect(planConflicts([{ keyword: 'Drain cleaning Lakeside' }], EXISTING, OPEN)[0]).toMatch(/already page #12 \(published at https:\/\/northwind-home\.example\/lakeside\/drain-cleaning\/\)/);
  });

  it('refuses a URL another page lives at or refreshes', () => {
    expect(planConflicts([{ keyword: 'lakeside drains', slug: 'lakeside/drain-cleaning' }], EXISTING, OPEN)[0]).toMatch(/page #12 "drain cleaning lakeside" already lives at/);
    expect(planConflicts([{ keyword: 'boiler repair', existingUrl: 'northwind-home.example/boilers/' }], EXISTING, OPEN)[0]).toMatch(/page #15 "boiler service" already targets/);
  });

  it('lets a refresh through, and a keyword from a closed batch that never went live, or a discarded page', () => {
    expect(planConflicts([
      { keyword: 'water heater repair fairview', refresh: true, existingUrl: 'https://northwind-home.example/fairview/water-heater-repair' },
      { keyword: 'sump pump repair' },
      { keyword: 'tankless water heaters' },
    ], EXISTING, OPEN)).toEqual([]);
  });

  it('refuses one keyword planned twice in the same plan', () => {
    expect(planConflicts([{ keyword: 'gas line repair' }, { keyword: 'Gas line repair' }], [], OPEN)).toEqual([expect.stringMatching(/planned twice in this batch/)]);
  });
});

describe('where a page lives', () => {
  it('reads a URL or a slug as the same path', () => {
    expect(pathKey('https://northwind-home.example/fairview/water-heater-repair/?utm=x')).toBe('/fairview/water-heater-repair');
    expect(pathKey('fairview/water-heater-repair')).toBe('/fairview/water-heater-repair');
    expect(pathKey('/fairview/water-heater-repair/')).toBe('/fairview/water-heater-repair');
  });

  it('prefers the live URL, then the page it refreshes, then its slug', () => {
    expect(targetOf({ slug: 'a', existingUrl: 'https://northwind-home.example/b', publishedUrl: 'https://northwind-home.example/c' })).toBe('https://northwind-home.example/c');
    expect(targetOf({ slug: 'a', existingUrl: 'https://northwind-home.example/b' })).toBe('https://northwind-home.example/b');
    expect(targetOf({ slug: 'a' })).toBe('a');
    expect(targetOf({})).toBeUndefined();
  });
});
