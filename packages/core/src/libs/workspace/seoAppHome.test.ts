import type { PageRow } from './pageFields';
import { describe, expect, it } from 'vitest';
import { readRecordsMeasure } from './appHome';
import { loadApp } from './apps';

const now = new Date('2026-10-30T15:00:00Z');

function page(id: number, status: string, publishedAt?: string): PageRow {
  return { id, title: `Page ${id}`, status: null, createdAt: now, meta: { status, publishedAt } };
}

describe('SEO home stage evidence', () => {
  it('keeps review, revisions, approved drafts and confirmed live pages distinct', () => {
    const rows = [
      page(1, 'in_review'),
      page(2, 'changes_requested'),
      page(3, 'approved'),
      page(4, 'publishing'),
      page(5, 'published', '2026-10-10T12:00:00Z'),
      page(6, 'published', '2026-09-10T12:00:00Z'),
      page(7, 'drafting'),
      page(8, 'published'),
    ];
    const measures = loadApp('seo').home!.measures!;
    const figures = measures.map(measure => readRecordsMeasure(measure, rows, { now }));

    expect(figures.map(figure => [figure!.key, figure!.value])).toEqual([
      ['review', '1'],
      ['revisions', '1'],
      ['approved', '1'],
      ['published', '3'],
    ]);
    expect(figures[0]!.href).toBe('/dashboard/p/seo-pages?status=in_review');
    expect(figures[2]!.href).toBe('/dashboard/p/seo-pages?status=approved');
    // The headline and its drilldown include the same published cohort, including older pages.
    expect(figures[3]!.href).toBe('/dashboard/p/seo-pages?status=published');
    expect(measures[3]!.label).toBe('Published pages');
  });
});
