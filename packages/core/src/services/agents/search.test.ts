/**
 * The regression these cover, in one sentence: a search hit reached the model
 * with no date on it, so nothing could tell yesterday's calendar event from
 * today's — and on 2026-09-17 the team lead presented one as that morning's
 * schedule.
 *
 * The date was missing because `SearchHit` never carried one and the
 * projection in `searchKnowledge.ts` built a `metadata` object out of chunk
 * debugging numbers instead of the document's own. That single gap disabled
 * four separate mechanisms, and there is a test below for each.
 */
import { describe, expect, it } from 'vitest';
import { dateStamp, renderDocLine, reRankResults, toSearchDocument } from './search';

const NOW = new Date('2026-09-17T16:00:00Z');
const config = { recencyDecay: undefined, sourceWeights: {}, maxResults: 15, minRelevance: 0 };

describe('dateStamp', () => {
  it('names today as today', () => {
    expect(dateStamp('2026-09-17T09:00:00Z', NOW)).toContain('TODAY');
  });

  it('says a day-old document is NOT today, in words', () => {
    // The whole point: a model can skim past an ISO string it would have to
    // diff against another ISO string. It cannot skim past this.
    const stamp = dateStamp('2026-09-16T15:30:00Z', NOW);

    expect(stamp).toContain('YESTERDAY');
    expect(stamp).toContain('not today');
  });

  it('counts calendar days, not 24-hour spans', () => {
    // 23:30 yesterday to 16:00 today is under 24h but is still yesterday.
    expect(dateStamp('2026-09-16T23:30:00Z', NOW)).toContain('YESTERDAY');
  });

  it('carries the year, because "Sep 16" alone reads as recent in any year', () => {
    expect(dateStamp('2025-09-16T10:00:00Z', NOW)).toContain('2025');
    expect(dateStamp('2025-09-16T10:00:00Z', NOW)).toContain('366 days ago');
  });

  it('handles the future without saying it is today', () => {
    expect(dateStamp('2026-09-18T10:00:00Z', NOW)).toContain('TOMORROW');
    expect(dateStamp('2026-09-20T10:00:00Z', NOW)).toContain('in 3 days');
  });

  it('returns nothing for a missing or unparseable date rather than inventing one', () => {
    expect(dateStamp(undefined, NOW)).toBe('');
    expect(dateStamp('not a date', NOW)).toBe('');
  });
});

describe('renderDocLine', () => {
  it('dates a calendar event by when it HAPPENS, not when the row was touched', () => {
    // The exact shape that misfired: an event scheduled yesterday whose row
    // was updated this morning. `updated_at` alone would call it today's.
    const line = renderDocLine({
      semantic_identifier: 'Pipeline review',
      source_type: 'google-calendar',
      blurb: 'Event: Pipeline review',
      updated_at: '2026-09-17T08:00:00Z',
      metadata: { kind: 'calendar-event', start: '2026-09-16T15:30:00Z' },
    }, 0, NOW);

    expect(line).toContain('YESTERDAY');
    expect(line).not.toContain('TODAY');
  });

  it('falls back to the document date when there is no event start', () => {
    const line = renderDocLine({
      semantic_identifier: 'Q3 notes',
      source_type: 'drive',
      updated_at: '2026-09-17T08:00:00Z',
    }, 0, NOW);

    expect(line).toContain('TODAY');
  });

  it('still renders a hit that has no date at all', () => {
    const line = renderDocLine({ semantic_identifier: 'Undated', source_type: 'web' }, 0, NOW);

    expect(line).toContain('[1] **Undated** [web]');
  });
});

describe('reRankResults', () => {
  const docs = [
    { document_id: 'old', score: 1, updated_at: '2026-08-18T10:00:00Z' },
    { document_id: 'new', score: 1, updated_at: '2026-09-17T10:00:00Z' },
  ];

  it('applies recency decay now that hits carry a date', () => {
    const ranked = reRankResults(docs, { ...config, recencyDecay: 0.9 });

    expect(ranked[0]!.document_id).toBe('new');
  });

  it('treats recencyDecay: 0 as OFF, not as "annihilate everything not from today"', () => {
    // Two call sites in this repo pass 0 meaning "no decay". Read literally,
    // `0 ** daysOld` is 0, which would zero every older document the moment
    // dates started flowing.
    const ranked = reRankResults(docs, { ...config, recencyDecay: 0 });

    expect(ranked.every(d => (d._adjustedScore ?? 0) > 0)).toBe(true);
  });

  it('boosts discovery calls by call_type, which needs real document metadata', () => {
    const ranked = reRankResults([
      { document_id: 'internal', score: 1, source_type: 'zoom', metadata: { call_type: 'internal' } },
      { document_id: 'discovery', score: 1, source_type: 'zoom', metadata: { call_type: 'discovery' } },
    ], config, { wantsDiscovery: true });

    expect(ranked[0]!.document_id).toBe('discovery');
  });
});

describe('toSearchDocument', () => {
  it('gives the sidebar chip the same date the model was given', () => {
    // One shape: the chip and the tool output must never disagree about when
    // something is from (design principle 6).
    const doc = toSearchDocument({
      document_id: '1',
      updated_at: '2026-09-17T08:00:00Z',
      metadata: { kind: 'calendar-event', start: '2026-09-16T15:30:00Z' },
    }, 3);

    expect(doc.updated_at).toBe('2026-09-16T15:30:00Z');
    expect(doc.citationIndex).toBe(3);
  });
});
