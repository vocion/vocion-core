import { describe, expect, it } from 'vitest';
import { stillHappening } from './stillHappening';

const NOW = new Date('2026-01-10T19:30:00Z');
const RELEASES = [
  { version: 'aaa111aaa111ff', createdAt: '2026-01-10T14:39:00Z' },
  { version: 'bbb222bbb222ff', createdAt: '2026-01-10T16:14:00Z' },
];

describe('is it still happening', () => {
  it('a fixed outage reads as stopped, with the release that went out after its last event', () => {
    const s = stillHappening({ lastSeen: '2026-01-10T15:47:00Z', status: 'unresolved' }, RELEASES, NOW);

    expect(s).toMatchObject({ state: 'stopped', quietMinutes: 223, releasesSince: [{ version: 'bbb222bbb222ff' }] });
    expect(s.line).toBe('Not happening now: the last event was 3h 43m ago. 1 release went out since (bbb222bbb222). Report what it was and what fixed it; open nothing urgent for it.');
  });

  it('an error seen minutes ago is still happening; one the tracker resolved is not', () => {
    expect(stillHappening({ lastSeen: '2026-01-10T19:25:00Z', status: 'unresolved' }, RELEASES, NOW)).toMatchObject({ state: 'ongoing', line: 'Still happening: the last event was 5m ago.' });
    expect(stillHappening({ lastSeen: '2026-01-10T19:25:00Z', status: 'resolved' }, RELEASES, NOW).state).toBe('stopped');
    expect(stillHappening({ lastSeen: null, status: null }, RELEASES, NOW).state).toBe('unknown');
  });
});
