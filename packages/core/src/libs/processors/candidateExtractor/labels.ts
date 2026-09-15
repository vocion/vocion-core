/**
 * Saying, on the card, what this record is to the ones already queued.
 *
 * Nothing here merges, folds in, or refreshes another card. Every occurrence
 * of a series is its own record with its own dedup key; the only output is a
 * sentence written into one configured field, which a reviewer reads and acts
 * on or ignores.
 *
 * Two labellers, in priority order:
 *
 *   1. **The model**, which saw the venue's known upcoming cards in its one
 *      call and answered `seriesOf` / `duplicateOf` (already checked against
 *      the ids that call actually carried, in `validate.ts`).
 *   2. **The deterministic sibling rule**, for the aggregator case where there
 *      is no known block at all, and as a cross-check everywhere else. Same
 *      normalised identity on `sameOn`, a different value on `differsOn`, read
 *      straight off the dedup key segments. A hit is a sibling; it earns a
 *      label when the anchor carries evidence of a repeat, or when there are
 *      two or more siblings.
 *
 * No fuzzy matching and no parsing of the recurrence text: core has no
 * `pg_trgm`, `action_run` has no index on `input`, and the pure-JavaScript
 * similarity scorer would need every candidate of the org fetched per record.
 *
 * Where both fire and disagree, the model wins and the disagreement is
 * counted, the counter is what makes the fallback's quality measurable
 * instead of assumed.
 */

import type { CandidateExtractorConfig } from './config';
import type { ValidatedRecord } from './validate';
import { candidateKeySegments, findSimilarCandidates, normaliseForKey } from '@/libs/actions/objects-propose-candidate';

/**
 * The two sentences a label can be. Parsed back out by the review card.
 * @param runId - The queued run the label points at.
 */
export const SERIES_LABEL = (runId: number): string => `part of series ${runId}`;
export const DUPLICATE_LABEL = (runId: number): string => `possible duplicate of ${runId}`;

/**
 * Write the labels for one document's records.
 *
 * Mutates `record.fields[flagField]` in place: the label has to be in the
 * payload BEFORE `proposeAction`, because a refresh rewrites `action_run.input`
 * wholesale and `onProposed` rewrites the object's metadata wholesale, so a
 * label written afterwards would be erased by the next sync.
 * @param opts - What to label and what to compare against.
 * @param opts.orgId - Org whose queue is searched.
 * @param opts.config - The source's processor config.
 * @param opts.records - Validated records, mutated in place.
 */
export async function labelRecords(opts: {
  orgId: string;
  config: CandidateExtractorConfig;
  records: ValidatedRecord[];
}): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const series = opts.config.seriesLabel;
  if (!series || opts.records.length === 0) {
    return counts;
  }
  const bump = (key: string): void => {
    counts[key] = (counts[key] ?? 0) + 1;
  };

  for (const record of opts.records) {
    // A duplicate is a stronger statement than a series membership, and the
    // model is the only thing that can make it, so it short-circuits.
    if (record.duplicateOf !== undefined) {
      record.fields[series.flagField] = DUPLICATE_LABEL(record.duplicateOf);
      bump('duplicate_flagged');
      continue;
    }

    const anchor = await findAnchor({ orgId: opts.orgId, config: opts.config, record });

    if (record.seriesOf !== undefined) {
      record.fields[series.flagField] = SERIES_LABEL(record.seriesOf);
      bump('series_labeled');
      if (anchor !== null && anchor !== record.seriesOf) {
        // Both fired and they named different cards. The model wins; the
        // counter is how we find out whether it should.
        bump('series_disagreement');
      }
      continue;
    }

    if (anchor !== null) {
      record.fields[series.flagField] = SERIES_LABEL(anchor);
      bump('series_labeled');
    }
  }

  return counts;
}

/**
 * The run id of the queued card this record is another date of, by the
 * deterministic rule alone, or null when the rule says nothing.
 * @param opts - What to look for.
 * @param opts.orgId - Org whose queue is searched.
 * @param opts.config - The source's processor config.
 * @param opts.record - The record being labelled.
 */
async function findAnchor(opts: {
  orgId: string;
  config: CandidateExtractorConfig;
  record: ValidatedRecord;
}): Promise<number | null> {
  const { config, record } = opts;
  const series = config.seriesLabel;
  if (!series) {
    return null;
  }

  let rows: Awaited<ReturnType<typeof findSimilarCandidates>>;
  try {
    rows = await findSimilarCandidates(
      opts.orgId,
      {
        objectType: config.objectType,
        title: String(record.fields[config.titleFrom] ?? ''),
        fields: record.fields,
        dedupOn: config.dedupOn,
      },
      { limit: series.maxAnchors },
    );
  } catch {
    // A broken sibling lookup costs a label, never the candidate.
    return null;
  }

  // Segment 0 of the key is `<action>:<type>`, so an identity field's segment
  // is its position in `dedupOn` plus one, and `values` here is already the
  // list after that head, so the position IS its `dedupOn` index.
  const sameIndexes = series.sameOn.map(field => config.dedupOn.indexOf(field)).filter(index => index >= 0);
  const differsIndex = config.dedupOn.indexOf(series.differsOn);
  if (differsIndex < 0) {
    return null;
  }

  const siblings: Array<{ id: number; evidence: boolean }> = [];
  for (const row of rows) {
    const segments = candidateKeySegments(row.dedupKey);
    if (!segments) {
      continue;
    }
    const sameOnMatches = sameIndexes.every(index =>
      segments.values[index] === normaliseForKey(record.fields[config.dedupOn[index] as string]));
    if (!sameOnMatches) {
      continue;
    }
    if (segments.values[differsIndex] === normaliseForKey(record.fields[series.differsOn])) {
      continue;
    }
    const fields = ((row.input as { fields?: Record<string, unknown> })?.fields ?? {});
    const evidence = series.evidenceField
      ? String(fields[series.evidenceField] ?? '').trim() !== ''
      : false;
    siblings.push({ id: row.id, evidence });
  }

  if (siblings.length === 0) {
    return null;
  }
  // One sibling is only a series when the anchor says so; two siblings are a
  // pattern on their own.
  const withEvidence = siblings.find(sibling => sibling.evidence);
  if (withEvidence) {
    return withEvidence.id;
  }
  if (siblings.length >= 2) {
    return Math.min(...siblings.map(sibling => sibling.id));
  }
  return null;
}
