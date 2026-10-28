import { describe, expect, it } from 'vitest';
import { seoRunReport } from './work';

const gate = (over: Partial<Parameters<typeof seoRunReport>[1]> = {}) => ({
  stage: 'sample' as const,
  line: '1 of 3 written · waiting on your feedback on the sample of 3',
  written: 1,
  approved: 0,
  total: 3,
  writable: [] as number[],
  waitingOnSignoff: [11],
  feedbackToFile: [] as number[],
  ...over,
});

describe('what a background run says in the conversation', () => {
  it('says where the batch stands, from the records', () => {
    const report = seoRunReport({ id: 7, title: 'Northwind Home Services: Boiler care', meta: {} }, gate());

    expect(report?.text).toBe('Northwind Home Services: Boiler care: 1 of 3 written · waiting on your feedback on the sample of 3. 1 page is waiting on your sign-off.');
  });

  it('stays silent when nothing changed since the last line (writeNow 0, waiting 1, again)', () => {
    const first = seoRunReport({ id: 7, title: 'Boiler care', meta: {} }, gate())!;

    expect(seoRunReport({ id: 7, title: 'Boiler care', meta: { toldState: first.state } }, gate())).toBeNull();
  });

  it('speaks again when something moved', () => {
    const first = seoRunReport({ id: 7, title: 'Boiler care', meta: {} }, gate())!;
    const moved = seoRunReport({ id: 7, title: 'Boiler care', meta: { toldState: first.state } }, gate({ line: '2 of 3 written · waiting on your feedback on the sample of 3', written: 2, waitingOnSignoff: [11, 12] }));

    expect(moved?.text).toContain('2 pages are waiting on your sign-off');
    expect(moved?.state).not.toBe(first.state);
  });
});
