import type { PageRow } from './pageFields';
import { describe, expect, it } from 'vitest';
import { groupRows, orderGroups, PageManifestSchema } from './pageFields';

const row = (id: number, status: string): PageRow => ({ id, title: `#${id}`, status: null, createdAt: null, meta: { status } });

describe('a declared group order', () => {
  it('puts the named groups first, in order, under their labels and limits; the rest follow', () => {
    // Sorted newest first: a resolved one was seen most recently.
    const groups = groupRows([row(1, 'resolved'), row(2, 'open'), row(3, 'resolved'), row(4, 'snoozed'), row(5, 'resolved')], 'meta.status');

    expect(orderGroups(groups, [{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Recently resolved', limit: 2 }]).map(g => [g.label, g.rows.map(r => r.id)]))
      .toEqual([['Open', [2]], ['Recently resolved', [1, 3]], ['snoozed', [4]]]);
    expect(orderGroups(groups, undefined)).toBe(groups);
  });

  it('needs groupBy', () => {
    const base = { slug: 'incidents', title: 'Incidents', archetype: 'list', source: { kind: 'objects', objectType: 'incident' } };

    expect(PageManifestSchema.safeParse({ ...base, groupOrder: [{ value: 'open' }] }).success).toBe(false);
    expect(PageManifestSchema.safeParse({ ...base, groupBy: 'meta.status', groupOrder: [{ value: 'open' }] }).success).toBe(true);
  });
});
