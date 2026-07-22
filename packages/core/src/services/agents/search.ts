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
  const decay = config.recencyDecay ?? 1.0;
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
 */
export function toSearchDocument(doc: RawDoc, citationIndex?: number): SearchDocument {
  return {
    document_id: doc.document_id ?? '',
    semantic_identifier: doc.semantic_identifier ?? doc.document_id ?? '',
    link: doc.link ?? '',
    source_type: doc.source_type ?? 'unknown',
    blurb: (doc.blurb ?? doc.content ?? '').slice(0, 2000),
    metadata: doc.metadata,
    updated_at: doc.updated_at ?? doc.last_modified,
    ...(citationIndex ? { citationIndex } : {}),
  };
}

/**
 * Render a numbered search hit for inclusion in the model's tool output.
 * @param doc
 * @param i
 */
export function renderDocLine(doc: RawDoc, i: number): string {
  const blurb = doc.blurb ?? doc.content ?? '';
  const title = doc.semantic_identifier ?? doc.document_id ?? '(no title)';
  const source = doc.source_type ?? 'unknown';
  const meta = doc.metadata ?? {};
  const rawDate = doc.updated_at ?? doc.last_modified ?? doc.doc_updated_at;
  let dateStr = '';
  if (rawDate) {
    try {
      dateStr = new Date(rawDate).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      /* ignore */
    }
  }
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
