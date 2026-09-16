import { describe, expect, it } from 'vitest';
import { recordLabel, recordRef } from './recordContext';

describe('recordRef', () => {
  it('fills the in-app route for a routable record', () => {
    expect(recordRef('ask', 7, 'Approve 014')).toEqual({ type: 'ask', id: '7', label: 'Approve 014', href: '/dashboard/inbox/7' });
    expect(recordRef('mission_run', 12)).toEqual({ type: 'mission_run', id: '12', href: '/dashboard/missions/runs/12' });
    expect(recordRef('agent', 'revenue-lead', 'RevOps Lead').href).toBe('/dashboard/agents/revenue-lead');
    // A Search result is a record like any other: it reaches the rail as
    // `@<title>` with a route back to the page it was opened from.
    expect(recordRef('document', 412, 'Q3 platform plan')).toEqual({
      type: 'document',
      id: '412',
      label: 'Q3 platform plan',
      href: '/dashboard/search/412',
    });
  });

  it('leaves the href off when the type has no page of its own', () => {
    expect(recordRef('deal', 'deals:611').href).toBeUndefined();
    expect(recordRef('object', 'contacts:9412').href).toBeUndefined();
    expect(recordRef('object', 44).href).toBe('/dashboard/objects/44');
  });

  it('labels a ref by name, else by type and id', () => {
    expect(recordLabel({ type: 'briefing', id: '61', label: 'Revenue Briefing' })).toBe('Revenue Briefing');
    expect(recordLabel({ type: 'worker_run', id: '9' })).toBe('worker run 9');
  });
});
