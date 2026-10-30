import { describe, expect, it } from 'vitest';
import { firstTile, tileHref } from './appHomeLinks';
import { loadApp } from './apps';

// Load the shipped manifest, not a second definition of the Finance home.
describe('Finance guided launcher', () => {
  it('starts with a draft packet whose reporting period the person supplies', () => {
    const home = loadApp('finance').home!;
    const first = firstTile(home);

    expect(home.launch).toHaveLength(6);
    expect(first).toBe(home.launch[0]);
    expect(first.prompt).toContain('Reporting month and year: ');
    expect(first.ask).toBeUndefined();
    expect(first.prompt).toContain('unverified close sign-off');
    expect(first.prompt).toContain('do not send');
    expect(tileHref(first)).toContain('prompt=');
  });

  it('keeps sampled state and execution status distinct from verified financial results', () => {
    const measures = loadApp('finance').home!.measures!;
    const close = measures.find(m => m.key === 'close')!;
    const cash = measures.find(m => m.key === 'cash')!;
    const overdue = measures.find(m => m.key === 'overdue')!;
    const approvals = measures.find(m => m.key === 'approvals')!;

    expect(close).toMatchObject({ label: 'Latest close run', source: 'mission', mission: 'close-the-month' });
    expect(cash).toMatchObject({ label: 'Synced bank balances', source: 'state', sum: 'balance' });
    expect(overdue).toMatchObject({ label: 'Synced overdue balance', source: 'state', view: 'overdue-invoices' });
    expect(approvals).toMatchObject({ label: 'Finance action approvals', source: 'approvals', actions: ['finance.*'] });
  });
});
