import { describe, expect, it } from 'vitest';
import { activeQueryFilters, applyQueryFilters } from './pageFields';

describe('a filter the URL switches on', () => {
  const rows = [
    { id: 1, title: 'a', status: null, createdAt: null, meta: { product: 'send' } },
    { id: 2, title: 'b', status: null, createdAt: null, meta: { product: 'Slate' } },
    { id: 3, title: 'c', status: null, createdAt: null, meta: {} },
  ];
  const declared = [{ param: 'product', field: 'meta.product', label: 'Product' }];

  it('narrows to the value, case-insensitively, and names what it did', () => {
    const active = activeQueryFilters(declared, { product: 'slate' });

    expect(active).toEqual([{ param: 'product', field: 'meta.product', label: 'Product', value: 'slate' }]);
    expect(applyQueryFilters(rows, active).map(r => r.id)).toEqual([2]);
  });

  it('switches nothing on for an absent or empty param', () => {
    expect(activeQueryFilters(declared, {})).toEqual([]);
    expect(activeQueryFilters(declared, { product: ' ' })).toEqual([]);
    expect(applyQueryFilters(rows, []).map(r => r.id)).toEqual([1, 2, 3]);
  });

  it('opens on a declared default, and `all` turns it off', () => {
    const withDefault = [{ ...declared[0]!, default: 'send' }];

    expect(applyQueryFilters(rows, activeQueryFilters(withDefault, {})).map(r => r.id)).toEqual([1]);
    expect(activeQueryFilters(withDefault, { product: 'all' })).toEqual([]);
    expect(activeQueryFilters(withDefault, { product: 'slate' })[0]!.value).toBe('slate');
  });
});
