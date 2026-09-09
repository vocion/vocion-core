/**
 * Mirror freshness — the property that keeps a true count from answering the
 * wrong question. "0 contacts in scope" and "0 contacts synced since Tuesday"
 * are the same integer, and only one of them means the CRM is quiet.
 *
 * The judgement is relative to each source's OWN cadence, so a daily sync two
 * hours old is healthy and an hourly one is not.
 */
import { describe, expect, it } from 'vitest';
import { judgeMirrorFreshness } from './CrmRecordsService';

const NOW = new Date('2026-09-08T20:00:00Z');
const HOUR = 3_600_000;

const src = (slug: string, schedule: string | null, agoMs: number | null) => ({
  slug,
  schedule,
  lastSyncedAt: agoMs === null ? null : new Date(NOW.getTime() - agoMs),
});

describe('judgeMirrorFreshness', () => {
  it('reads the expected cadence off the source\'s own cron', () => {
    const f = judgeMirrorFreshness([src('hubspot-contacts', '0 * * * *', 10 * 60_000)], NOW);

    expect(f.expectedEveryMs).toBe(HOUR);
    expect(f.stale).toBe(false);
    expect(f.reason).toBeNull();
    expect(f.asOf?.toISOString()).toBe('2026-09-08T19:50:00.000Z');
  });

  it('calls the production case stale: a daily sync seven days behind', () => {
    const f = judgeMirrorFreshness([src('hubspot-contacts', '0 6 * * *', 7 * 24 * HOUR)], NOW);

    expect(f.stale).toBe(true);
    expect(f.reason).toContain('hubspot-contacts');
    expect(f.reason).toContain('7.0 days');
  });

  it('leaves the same age healthy once the sync runs every 15 minutes', () => {
    const f = judgeMirrorFreshness([src('hubspot-contacts', '*/15 * * * *', 12 * 60_000)], NOW);

    expect(f.stale).toBe(false);
    expect(f.expectedEveryMs).toBe(15 * 60_000);
  });

  it('does not flag a daily source that is merely mid-interval', () => {
    expect(judgeMirrorFreshness([src('hubspot', '0 6 * * *', 14 * HOUR)], NOW).stale).toBe(false);
  });

  it('flags an hourly source that has missed more than one turn', () => {
    expect(judgeMirrorFreshness([src('hubspot', '0 * * * *', 19.3 * HOUR)], NOW).stale).toBe(true);
  });

  it('judges a mixed answer on its slowest input, and names the stalest source', () => {
    const f = judgeMirrorFreshness(
      [src('hubspot-contacts', '*/15 * * * *', 5 * 60_000), src('hubspot-companies', '0 6 * * *', 30 * HOUR)],
      NOW,
    );

    // The slowest cadence sets the allowance, so 30 hours on a daily source is
    // still inside it — but the reported `asOf` is the stalest input.
    expect(f.expectedEveryMs).toBe(24 * HOUR);
    expect(f.stale).toBe(false);
    expect(f.asOf?.toISOString()).toBe('2026-09-07T14:00:00.000Z');
  });

  it('treats a never-synced source as stale, because the records are simply absent', () => {
    const f = judgeMirrorFreshness([src('hubspot-contacts', '0 * * * *', null)], NOW);

    expect(f.stale).toBe(true);
    expect(f.asOf).toBeNull();
    expect(f.reason).toContain('never synced');
  });

  it('proves nothing about a source with no schedule at all', () => {
    const f = judgeMirrorFreshness([src('hubspot-contacts', null, 40 * 24 * HOUR)], NOW);

    expect(f.expectedEveryMs).toBeNull();
    expect(f.stale).toBe(false);
  });

  it('is not stale when there is no source to be stale about', () => {
    expect(judgeMirrorFreshness([], NOW).stale).toBe(false);
  });
});
