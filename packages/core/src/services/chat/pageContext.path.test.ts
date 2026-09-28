import { describe, expect, it } from 'vitest';
import { readPageContext, recordFromPath } from './pageContext';

describe('the page always names its record', () => {
  it('reads the record from the path when the page did not register one (Chris, 2026-09-28: feature #40)', () => {
    expect(readPageContext({ path: '/w/squatch-factory/dashboard/p/feature/40', title: 'Rename Send to Stamp' })?.record).toEqual({ type: 'object', id: '40', label: 'Rename Send to Stamp', href: '/dashboard/p/feature/40' });
    expect(recordFromPath('/en/dashboard/objects/131')).toMatchObject({ type: 'object', id: '131' });
    expect(recordFromPath('/w/squatch-factory/dashboard/p/runs/397?view=all')).toMatchObject({ type: 'worker_run', id: '397' });
    expect(recordFromPath('/w/squatch-factory/dashboard/p/runs/agent-5862')).toMatchObject({ type: 'mission_run', id: '5862' });
    expect(recordFromPath('/w/squatch-factory/dashboard/p/work')).toBeNull();
    expect(recordFromPath('/dashboard/p/wiki/how-stamp-ships')).toBeNull();
  });

  it('never overrides a record the page registered itself', () => {
    expect(readPageContext({ path: '/dashboard/p/feature/40', title: 't', record: { type: 'deal', id: '9' } })?.record).toMatchObject({ type: 'deal', id: '9' });
  });
});
