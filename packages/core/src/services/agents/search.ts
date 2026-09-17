/**
 * Search-result helpers shared across agent tools.
 *
 * `reRankResults` mirrors the logic in services/AgentService.ts so we
 * can swap the runtime without losing the per-tenant search tuning
 * (recency decay, source weighting, discovery-intent boost). Once the
 * legacy runtime is retired this file becomes the canonical home and
 * AgentService.ts re-exports from here.
 */

import type { SearchConfig, SearchDocument } from './types';

export type RawDoc = {
  document_id?: string;
  semantic_identifier?: string;
  link?: string;
  source_type?: string;
  blurb?: string;
  content?: string;
  score?: number;
  updated_at?: string;
  last_modified?: string;
  doc_updated_at?: string;
  metadata?: Record<string, unknown> & { call_type?: string };
  _adjustedScore?: number;
};

export type QueryIntent = { wantsDiscovery?: boolean };

export function reRankResults(
  docs: RawDoc[],
  config: SearchConfig,
  intent?: QueryIntent,
): RawDoc[] {
  const now = Date.now();
  const configured = config.recencyDecay ?? 1.0;
  // `0` means "no decay" to everyone who writes it — two call sites in this
  // repo and any workspace authoring `recencyDecay: 0` in YAML. Read literally
  // it means the opposite: `0 ** daysOld` is 0, which would annihilate every
  // document not from today. Only a value strictly between 0 and 1 is a decay
  // rate, so anything else is off.
  //
  // This guard was dead code until now. Until the fix below it, no hit carried
  // a date, so the whole branch never ran and `recencyDecay` had no effect
  // anywhere — which is part of why a day-old calendar event outranked a
  // current one.
  const decay = configured > 0 && configured < 1 ? configured : 1.0;
  const sourceWeights = config.sourceWeights ?? {};

  const scored = docs.map((doc) => {
    let score = doc.score ?? 1.0;

    if (decay < 1.0) {
      const updatedAt = doc.updated_at ?? doc.last_modified ?? doc.doc_updated_at;
      if (updatedAt) {
        const docDate = new Date(updatedAt).getTime();
        const daysOld = Math.max(0, (now - docDate) / (1000 * 60 * 60 * 24));
        score *= decay ** daysOld;
      }
    }

    const sourceType = doc.source_type ?? '';
    score *= sourceWeights[sourceType] ?? 1.0;

    const callType = doc.metadata?.call_type ?? '';
    if (intent?.wantsDiscovery) {
      if (callType === 'discovery') {
        score *= 3.0;
      } else if (callType === 'internal') {
        score *= 0.1;
      } else if (callType === 'check-in') {
        score *= 0.2;
      } else if (callType === 'kickoff') {
        score *= 0.3;
      } else if (callType === 'interview') {
        score *= 0.15;
      } else if (callType === 'other') {
        score *= 0.4;
      } else if (!callType && sourceType === 'zoom') {
        score *= 0.5;
      }
    }

    return { ...doc, _adjustedScore: score };
  });

  scored.sort((a, b) => (b._adjustedScore ?? 0) - (a._adjustedScore ?? 0));
  return scored;
}

/**
 * Project a raw doc to the shape the chat sidebar expects.
 * @param doc
 * @param citationIndex
 */
export function toSearchDocument(doc: RawDoc, citationIndex?: number): SearchDocument {
  return {
    document_id: doc.document_id ?? '',
    semantic_identifier: doc.semantic_identifier ?? doc.document_id ?? '',
    link: doc.link ?? '',
    source_type: doc.source_type ?? 'unknown',
    blurb: (doc.blurb ?? doc.content ?? '').slice(0, 2000),
    metadata: doc.metadata,
    // Same date rule the model is given in `renderDocLine`: a calendar event
    // is dated by when it happens. One shape, so the chip in the sidebar and
    // the hit in the tool output can never disagree about when something is
    // from (design principle 6).
    updated_at: (typeof (doc.metadata as { start?: unknown } | undefined)?.start === 'string'
      ? (doc.metadata as { start: string }).start
      : undefined) ?? doc.updated_at ?? doc.last_modified,
    ...(citationIndex ? { citationIndex } : {}),
  };
}

/**
 * Render a numbered search hit for inclusion in the model's tool output.
 * @param doc
 * @param i
 */
/**
 * UTC midnight for a date, so "how many days ago" counts calendar days.
 * @param d
 */
function utcDay(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
}

/**
 * A document's date written so a model cannot mistake it for today.
 *
 * The comparison is done HERE, in code, rather than left to the model. A bare
 * "Tue, Sep 16" reads as current to a reader with a fuzzy sense of the date,
 * and on 2026-09-17 that is exactly what happened: the lead surfaced a
 * calendar event from the previous day as that morning's schedule. The prompt
 * already told it to check dates against NOW and it did not, which is the
 * repo's standing lesson — when a behaviour is a requirement, enforce it in
 * code instead of asking again (CLAUDE.md, "structural over prompting").
 *
 * So the relative word is precomputed and non-negotiable: a model can overlook
 * an ISO timestamp it has to diff against another ISO timestamp, but it cannot
 * read "(YESTERDAY — not today)" and still call it today's.
 * @param raw - An ISO date string, or anything `Date` can parse.
 * @param now - Reference instant; injectable so tests do not depend on the clock.
 * @returns A stamp like `Tue Sep 16, 2026 (YESTERDAY — not today)`, or '' when unparseable.
 */
export function dateStamp(raw: string | undefined, now: Date = new Date()): string {
  if (!raw) {
    return '';
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  // The year is part of the stamp on purpose — "Sep 16" alone is ambiguous
  // across years and reads as recent whatever year it is from.
  const label = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const days = utcDay(now) - utcDay(d);
  let rel: string;
  if (days === 0) {
    rel = 'TODAY';
  } else if (days === 1) {
    rel = 'YESTERDAY — not today';
  } else if (days === -1) {
    rel = 'TOMORROW — not today';
  } else if (days > 1) {
    rel = `${days} days ago — not today`;
  } else {
    rel = `in ${-days} days — not today`;
  }
  return `${label} (${rel})`;
}

/**
 * Render a numbered search hit for inclusion in the model's tool output.
 * @param doc
 * @param i
 * @param now - Reference instant for the date stamp; injectable for tests.
 */
export function renderDocLine(doc: RawDoc, i: number, now: Date = new Date()): string {
  const blurb = doc.blurb ?? doc.content ?? '';
  const title = doc.semantic_identifier ?? doc.document_id ?? '(no title)';
  const source = doc.source_type ?? 'unknown';
  const meta = doc.metadata ?? {};
  // A calendar event is dated by WHEN IT HAPPENS, not by when the row was last
  // touched: an event edited this morning but scheduled yesterday is still
  // yesterday's, and `updated_at` would call it today's.
  const eventStart = typeof (meta as { start?: unknown }).start === 'string'
    ? (meta as { start: string }).start
    : undefined;
  const rawDate = eventStart ?? doc.updated_at ?? doc.last_modified ?? doc.doc_updated_at;
  const dateStr = dateStamp(rawDate, now);
  const host = (meta as { host?: string }).host ?? '';
  const duration = (meta as { duration_minutes?: number }).duration_minutes
    ? `${(meta as { duration_minutes: number }).duration_minutes} min`
    : '';
  const callType = (meta as { call_type?: string }).call_type ?? '';
  const metaParts = [dateStr, duration, host, callType].filter(Boolean).join(' · ');
  return [
    `[${i + 1}] **${title}** [${source}]`,
    metaParts ? `   ${metaParts}` : '',
    `   ${blurb.slice(0, 400)}`,
  ].filter(Boolean).join('\n');
}
