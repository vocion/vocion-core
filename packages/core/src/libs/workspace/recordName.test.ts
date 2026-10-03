import { describe, expect, it } from 'vitest';
import { assembleFeatureReport } from '@/services/factory/featureReport';
import { resolveField } from './pageFields';

/**
 * Every surface that shows a request reads its short name before its title
 * (Chris, 2026-10-03): a Work row through the `name` accessor, the feature
 * page header through the report. Fictional fixture (Northwind).
 */

const ASK = 'On the Northwind library list, let me sort the documents by name, upload date or last opened, newest first by default, and remember my choice next time I open the library';

describe('a record\'s name on a page row', () => {
  it('is the stored name, else the title', () => {
    expect(resolveField({ id: 402, title: ASK, status: null, createdAt: null, meta: { name: 'Sort the library by name, date or last opened' } }, 'name')).toBe('Sort the library by name, date or last opened');
    expect(resolveField({ id: 403, title: 'Sort the library', status: null, createdAt: null, meta: {} }, 'name')).toBe('Sort the library');
    // The title accessor is the title, unchanged.
    expect(resolveField({ id: 402, title: ASK, status: null, createdAt: null, meta: { name: 'Sort the library' } }, 'title')).toBe(ASK);
  });
});

describe('a feature page\'s heading', () => {
  const report = (meta: Record<string, unknown>) => assembleFeatureReport({
    request: { id: 402, title: ASK, status: 'open', createdAt: new Date('2026-10-02T07:12:00Z'), meta },
    tasks: [],
    plans: [],
    workerRuns: [],
    asks: [],
    actionRuns: [],
    releases: [],
    artifacts: [],
    now: new Date('2026-10-02T12:00:00Z'),
  });

  it('is the short name when one is stored, and the ask stays the ask', () => {
    const named = report({ name: 'Sort the library by name, date or last opened' });

    expect(named.title).toBe('Sort the library by name, date or last opened');
    expect(named.asked).toBe(ASK);
    expect(report({}).title).toBe(ASK);
  });
});
