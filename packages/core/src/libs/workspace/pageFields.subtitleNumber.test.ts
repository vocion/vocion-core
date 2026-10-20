import type { PageField, PageRow } from '@/libs/workspace/pageFields';
import { describe, expect, it } from 'vitest';
import { subtitleNumberLabel } from '@/libs/workspace/pageFields';

const row: PageRow = { id: 515, title: 'MetaCTO monthly close', status: 'approved', createdAt: null, meta: { closeBusinessDay: 5, materiality: '500', entity: 'MetaCTO, LLC.' } };
const field = (over: Partial<PageField> & Pick<PageField, 'key' | 'label'>): PageField => ({ format: 'text', total: false, priority: 1, hideWhenConstant: false, ...over } as PageField);

describe('subtitleNumberLabel', () => {
  it('labels a bare number in the subtitle, so the close calendar reads "Close by business day 5 · Materiality $500"', () => {
    expect(subtitleNumberLabel(row, field({ key: 'closeDay', label: 'Close by business day', from: 'meta.closeBusinessDay' }))).toBe('Close by business day');
    expect(subtitleNumberLabel(row, field({ key: 'materiality', label: 'Materiality $', from: 'meta.materiality', format: 'mono' }))).toBe('Materiality $');
  });

  it('leaves words, money and badges as they are', () => {
    expect(subtitleNumberLabel(row, field({ key: 'entity', label: 'Entity', from: 'meta.entity' }))).toBeNull();
    expect(subtitleNumberLabel(row, field({ key: 'materiality', label: 'Materiality', from: 'meta.materiality', format: 'money' }))).toBeNull();
    expect(subtitleNumberLabel(row, field({ key: 'status', label: 'Status', from: 'status', format: 'badge' }))).toBeNull();
  });
});
