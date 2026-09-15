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
 *
 * Alongside the sentence, and only when the tenant configures a field for it,
 * the record is stamped with the GROUP it belongs to: the run id of the first
 * card of the series, as a bare decimal string. It is root-normalised at write
 * time, so `card3 -> card2 -> card1` collapses to card1 and no reader ever
 * walks a chain. See `seriesLabel.keyField` in `config.ts` for why the anchor
 * itself carries none.
 */

import type { CandidateExtractorConfig } from './config';
import type { KnownCards } from './knownCards';
import type { ValidatedRecord } from './validate';
import { candidateKeySegments, findSimilarCandidates, LABELLED_RUN_ID, normaliseForKey } from '@/libs/actions/objects-propose-candidate';
import { scrubMarkers, SERIES_NOTE_CAP } from './prompt';

/**
 * The two sentences a label can be. Parsed back out by the review card.
 * @param runId - The queued run the label points at.
 */
export const SERIES_LABEL = (runId: number): string => `part of series ${runId}`;
export const DUPLICATE_LABEL = (runId: number): string => `possible duplicate of ${runId}`;

/**
 * What a model-written off-schedule note is allowed to carry onto a card.
 *
 * The note is the only free text in this file, it comes from a page, and it
 * lands in a tenant field a later sync can read back (a tenant may point
 * `evidenceField` at the same field the label goes in). So it is treated as
 * the `<known>` block's own lines are, plus the one step those do not need:
 *
 *   1. the `scrubCardText` steps, no code fences, no closing-tag openers, one
 *      line, so the note cannot forge structure in a later prompt;
 *   2. the prompt's own marker literals, so it cannot forge a block tag;
 *   3. `LABELLED_RUN_ID`, the phrase `objects-propose-candidate` reads back off
 *      the payload to decide which runs to leave out of the "Possible
 *      duplicate" row. This is the step with teeth: an unscrubbed note naming
 *      "part of series 999" would silently suppress that row for a run of the
 *      page's choosing;
 *   4. the length cap, applied LAST, so escaping can never push the value over
 *      it.
 * @param value - Whatever the model put in `seriesNote`.
 */
export function scrubSeriesNote(value: unknown): string {
  const oneLine = String(value ?? '')
    .replace(/```/g, '')
    .replace(/<\//g, '< /')
    .replace(/[\n\r|]+/g, ' ');
  return scrubMarkers(oneLine)
    .replace(LABELLED_RUN_ID, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SERIES_NOTE_CAP);
}

/**
 * The group a record belongs to, always the root of its series.
 *
 * The invariant that makes this one hop rather than a walk: a key is
 * root-normalised at write time, so an anchor that has one is already pointing
 * at the root, and an anchor that has none IS the root.
 * @param anchorKey - The anchor card's own key, or null when it has none.
 * @param anchorId - The anchor card's run id.
 */
function rootKeyFor(anchorKey: string | null, anchorId: number): string {
  const inherited = (anchorKey ?? '').trim();
  return inherited === '' ? String(anchorId) : inherited;
}

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
 * @param opts.known - The cards this call's prompt carried, for their own group keys.
 */
export async function labelRecords(opts: {
  orgId: string;
  config: CandidateExtractorConfig;
  records: ValidatedRecord[];
  known: KnownCards;
}): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const series = opts.config.seriesLabel;
  if (!series || opts.records.length === 0) {
    return counts;
  }
  const bump = (key: string): void => {
    counts[key] = (counts[key] ?? 0) + 1;
  };

  // Every write goes through here, so the proposal can declare exactly which
  // fields this stage decided rather than read off the document. That list is
  // what the decision compares against once a reviewer has been through it.
  const write = (record: ValidatedRecord, field: string, value: string): void => {
    record.fields[field] = value;
    record.labelledFields = [...new Set([...(record.labelledFields ?? []), field])];
  };

  const keyField = series.keyField;
  const keySeries = (record: ValidatedRecord, anchorKey: string | null, anchorId: number): void => {
    if (!keyField) {
      return;
    }
    write(record, keyField, rootKeyFor(anchorKey, anchorId));
    bump('series_keyed');
    if ((anchorKey ?? '').trim() !== '') {
      // The one counter that proves the collapse: while this stays at zero
      // every group is one hop deep and the invariant is never exercised.
      bump('series_key_inherited');
    }
  };

  for (const record of opts.records) {
    // A duplicate is a stronger statement than a series membership, and the
    // model is the only thing that can make it, so it short-circuits. No key
    // is written: a duplicate is not a member of a series, and the `continue`
    // below is what keeps the key code out of reach.
    if (record.duplicateOf !== undefined) {
      write(record, series.flagField, DUPLICATE_LABEL(record.duplicateOf));
      bump('duplicate_flagged');
      continue;
    }

    const anchor = await findAnchor({ orgId: opts.orgId, config: opts.config, record });

    if (record.seriesOf !== undefined) {
      // The model named a card from the block, so its key is already in hand:
      // no second query, and the record joins that card's group rather than
      // starting one at it.
      const named = opts.known.cards.find(card => card.runId === record.seriesOf) ?? null;
      const note = scrubSeriesNote(record.seriesNote);
      write(
        record,
        series.flagField,
        note === '' ? SERIES_LABEL(record.seriesOf) : `${SERIES_LABEL(record.seriesOf)}; ${note}`,
      );
      bump('series_labeled');
      keySeries(record, named?.seriesKey ?? null, record.seriesOf);
      if (anchor !== null && anchor.id !== record.seriesOf) {
        // Both fired and they named different cards. The model wins; the
        // counter is how we find out whether it should.
        bump('series_disagreement');
      }
      continue;
    }

    if (anchor !== null) {
      write(record, series.flagField, SERIES_LABEL(anchor.id));
      bump('series_labeled');
      keySeries(record, anchor.seriesKey, anchor.id);
    }
  }

  return counts;
}

/**
 * The queued card this record is another date of, by the deterministic rule
 * alone, or null when the rule says nothing. Its own group key rides back with
 * it, read off the row's stored payload, which the lookup already returned.
 * @param opts - What to look for.
 * @param opts.orgId - Org whose queue is searched.
 * @param opts.config - The source's processor config.
 * @param opts.record - The record being labelled.
 */
async function findAnchor(opts: {
  orgId: string;
  config: CandidateExtractorConfig;
  record: ValidatedRecord;
}): Promise<{ id: number; seriesKey: string | null } | null> {
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

  const siblings: Array<{ id: number; evidence: boolean; seriesKey: string | null }> = [];
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
    const keyField = series.keyField;
    siblings.push({
      id: row.id,
      evidence,
      seriesKey: keyField ? (String(fields[keyField] ?? '').trim() || null) : null,
    });
  }

  if (siblings.length === 0) {
    return null;
  }
  // One sibling is only a series when the anchor says so; two siblings are a
  // pattern on their own.
  const withEvidence = siblings.find(sibling => sibling.evidence);
  if (withEvidence) {
    return withEvidence;
  }
  if (siblings.length >= 2) {
    return siblings.reduce((lowest, sibling) => (sibling.id < lowest.id ? sibling : lowest));
  }
  return null;
}
