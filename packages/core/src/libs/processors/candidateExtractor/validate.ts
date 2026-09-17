/**
 * What happens to the model's answer before anything is proposed.
 *
 * Three gates, in order:
 *
 *   1. **The envelope**, done in `model.ts`, by zod, so a malformed answer
 *      earns the corrective retry rather than reaching here.
 *   2. **Hard drops and the operator's knobs**, this file. Everything here is
 *      deterministic and configuration-driven: a tenant cannot run code inside
 *      core's processor, so each rule a tenant needs is a knob whose name says
 *      what it does to a record and never whose rule it is.
 *   3. **The object type's JSON Schema**, report only, through the action's
 *      own `describeSchemaProblems`. A candidate that does not fit still
 *      reaches the queue with the mismatch written on it, because a human
 *      deciding on a flawed extraction beats an agent silently dropping it.
 *      That is the philosophy of `objects-propose-candidate.ts`, and this
 *      stage does not get to be stricter than the action it feeds.
 *
 * The URL rule is worth naming: a model-returned URL the page never published
 * loses the URL, not the record. "Accepted only if the page published it" is a
 * statement about the value; throwing away a correct event because its image
 * link was invented would cost more than it saves.
 */

import type { CandidateExtractorConfig } from './config';
import type { ExtractedRecord } from './model';
import type { PageLink } from '@/libs/sources/pageMetadata';
import { normaliseForKey } from '@/libs/actions/objects-propose-candidate';
import { calendarDayOf } from './knownCards';

/** A record that survived the gates, with whatever the gates had to say. */
export type ValidatedRecord = ExtractedRecord & {
  /** Per-record notes, shown to the reviewer as extraction notes. */
  issues: string[];
  /**
   * Fields `labels.ts` wrote itself, rather than read off the document. Set by
   * that stage and declared on the proposal by `propose.ts`, so a reviewer's
   * decision can say what happened to each one. Absent on a record nothing
   * labelled, which declares nothing.
   */
  labelledFields?: string[];
};

export type ValidationOutput = {
  records: ValidatedRecord[];
  /** Flat counters for the run, merged under `extract.` by the runner. */
  counts: Record<string, number>;
  /** Run-level notes, for the processor result. */
  notes: string[];
};

/**
 * Today as a calendar day in a given zone.
 * @param timezone - IANA zone name, or undefined for UTC.
 * @param now - Clock, so a test can pin the day.
 */
export function calendarToday(timezone: string | undefined, now: Date = new Date()): string {
  if (!timezone) {
    return now.toISOString().slice(0, 10);
  }
  try {
    // `en-CA` formats as YYYY-MM-DD, which is the comparison order we want.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    // An unparseable zone is a config bug caught at apply time; falling back
    // to UTC here keeps a run going rather than failing every document.
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Digit runs in a value, which are what a document has to corroborate.
 * @param value - The field value.
 */
function digitRuns(value: unknown): string[] {
  return String(value ?? '').match(/\d+/g) ?? [];
}

/**
 * Whether a value reads as filled in.
 * @param value - The field value.
 */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0);
}

/**
 * A URL with its whitespace removed, which is how both sides of the gate are
 * compared.
 *
 * A calendar feed folds a long line, and the model is shown the document as it
 * was written, folds and all, while the connector declares the value joined
 * back up. Comparing the two literally would drop exactly the long URLs a fold
 * exists for. No real URL carries whitespace, so removing it costs nothing and
 * makes the comparison independent of how the model handled the fold.
 * @param url - either side's URL.
 */
function squashUrl(url: string): string {
  return url.replace(/\s+/g, '');
}

/**
 * Every URL the document itself published, the gate a model-returned URL has
 * to pass. Named apart from the `publishedUrls` option it reads, which is one
 * of its three inputs rather than the whole answer.
 * @param links - `metadata.links`, the pre-strip list.
 * @param jsonLd - The page's JSON-LD blocks.
 * @param declared - `metadata.publishedUrls`, the URLs a non-HTML document
 * stated for itself, which is the only list a feed entry has.
 */
function documentUrls(
  links: PageLink[] | undefined,
  jsonLd: unknown[] | undefined,
  declared: string[] | undefined,
): { exact: Set<string>; blob: string } {
  // Held in the squashed form, which is also the form a match is stored in.
  // RFC 3986 has no whitespace in a URL at all, so any that reaches here is an
  // artifact of how a line was written down rather than part of the address.
  // Keeping either side's spelling instead would put that whitespace in the
  // `sourceUrl` a reviewer clicks: the model's, when it hands back a folded
  // value it read; the document's, when a feed writes a space into its own
  // ATTACH. Only ICS can carry one this far, since the HTML and JSON paths
  // resolve through `absoluteUrl`, which percent-encodes.
  const exact = new Set<string>();
  for (const link of links ?? []) {
    if (link?.url) {
      exact.add(squashUrl(link.url));
    }
  }
  // A document that is not an HTML page has no parsed links and no JSON-LD, so
  // on its own it publishes nothing and every URL a model reads out of it gets
  // dropped. A calendar entry or a JSON feed item states its URLs directly and
  // the connector hands them over here. Guarded rather than trusted: the blob
  // is stored jsonb and a row holding a bare string would otherwise iterate
  // character by character into the set.
  for (const url of Array.isArray(declared) ? declared : []) {
    if (typeof url === 'string') {
      exact.add(squashUrl(url));
    }
  }
  // JSON-LD carries URLs inside nested objects (`offers.url`, `image`), so a
  // substring check over the serialised blocks is the honest gate: the value
  // has to literally occur in what the page published.
  const blob = jsonLd && jsonLd.length > 0 ? JSON.stringify(jsonLd) : '';
  return { exact, blob };
}

/**
 * Apply every gate to one document's records.
 * @param opts - Everything the gates read.
 * @param opts.records - What the model returned.
 * @param opts.config - The source's processor config.
 * @param opts.pageText - The document's text, for the corroboration rule.
 * @param opts.links - `metadata.links` from the page, for the URL gate.
 * @param opts.jsonLd - `metadata.jsonLd` from the page, for the URL gate.
 * @param opts.publishedUrls - `metadata.publishedUrls`, the URLs a feed entry
 * declared for itself, for the same gate.
 * @param opts.knownIds - Run ids the prompt actually carried.
 * @param opts.today - Today as a calendar day in the config's timezone.
 */
export function validateRecords(opts: {
  records: ExtractedRecord[];
  config: CandidateExtractorConfig;
  pageText: string;
  links?: PageLink[];
  jsonLd?: unknown[];
  publishedUrls?: string[];
  knownIds: Set<number>;
  today: string;
}): ValidationOutput {
  const { config } = opts;
  const counts: Record<string, number> = {};
  const notes: string[] = [];
  const bump = (key: string): void => {
    counts[key] = (counts[key] ?? 0) + 1;
  };

  const urls = documentUrls(opts.links, opts.jsonLd, opts.publishedUrls);
  // Answers with the URL to store rather than with a yes, because the gate is
  // the last place that knows both spellings. A feed folds a long line and the
  // model may hand the value back with the fold still in it, so blessing the
  // string and keeping it puts a newline in the link a reviewer clicks. The
  // answer is the whitespace-free form, which is the address in both spellings.
  // The JSON-LD arm matches on the raw value, so it has no such form to offer
  // and returns what it was given.
  const published = (url: string | undefined): string | undefined => {
    if (!url) {
      return undefined;
    }
    const squashed = squashUrl(url);
    if (urls.exact.has(squashed)) {
      return squashed;
    }
    return urls.blob !== '' && urls.blob.includes(url) ? url : undefined;
  };

  const kept: ValidatedRecord[] = [];
  for (const raw of opts.records) {
    const record: ValidatedRecord = { ...raw, fields: { ...raw.fields }, issues: [] };

    // Defaults first: they are what a venue site's page leaves unsaid, and the
    // identity check below has to see them.
    for (const [field, value] of Object.entries(config.defaults ?? {})) {
      if (isBlank(record.fields[field])) {
        record.fields[field] = value;
      }
    }

    if (record.confidence < config.minConfidence) {
      bump('skipped.below_confidence');
      continue;
    }

    const blankIdentity = config.dedupOn.filter(field => isBlank(record.fields[field]));
    if (blankIdentity.length > 0) {
      bump('skipped.incomplete');
      continue;
    }

    if (config.dropIfPast) {
      const day = calendarDayOf(record.fields[config.dropIfPast.field]);
      const keepUntil = config.dropIfPast.keepIfField
        ? calendarDayOf(record.fields[config.dropIfPast.keepIfField])
        : null;
      // The multi-day carve-out: something that started yesterday and runs to
      // next week is still on.
      if (day && day < opts.today && !(keepUntil && keepUntil >= opts.today)) {
        bump('skipped.past');
        continue;
      }
    }

    let dropped = false;
    for (const [field, allowed] of Object.entries(config.allowedValues ?? {})) {
      const value = record.fields[field];
      if (isBlank(value)) {
        continue;
      }
      const allowedSet = new Set(allowed);
      if (Array.isArray(value)) {
        const ok = value.filter(item => allowedSet.has(String(item)));
        if (ok.length === value.length) {
          continue;
        }
        if (config.onViolation === 'dropRecord') {
          dropped = true;
          break;
        }
        record.fields[field] = ok;
        record.issues.push(`${field}: dropped ${value.length - ok.length} value(s) the record type does not allow`);
        bump('skipped.bad_category');
      } else if (!allowedSet.has(String(value))) {
        if (config.onViolation === 'dropRecord') {
          dropped = true;
          break;
        }
        delete record.fields[field];
        record.issues.push(`${field}: "${String(value)}" is not one of the allowed values, so it was dropped`);
        bump('skipped.bad_category');
      }
    }
    if (dropped) {
      bump('skipped.bad_category');
      continue;
    }

    // "Never guess a price" as a check rather than a request: every digit run
    // in the value has to occur in the document.
    for (const field of config.mustAppearInDocument ?? []) {
      const value = record.fields[field];
      if (isBlank(value)) {
        continue;
      }
      const runs = digitRuns(value);
      if (runs.length > 0 && !runs.every(run => opts.pageText.includes(run))) {
        delete record.fields[field];
        record.issues.push(`${field}: dropped, its digits do not appear anywhere in the document`);
      }
    }

    if (record.sourceUrl) {
      const declared = published(record.sourceUrl);
      if (declared === undefined) {
        record.issues.push('the source URL was not published by the document, so it was dropped');
        delete record.sourceUrl;
      } else {
        record.sourceUrl = declared;
      }
    }
    if (record.imageUrl) {
      const declared = published(record.imageUrl);
      if (declared === undefined) {
        record.issues.push('the image URL was not published by the document, so it was dropped');
        delete record.imageUrl;
      } else {
        record.imageUrl = declared;
      }
    }
    if (config.imageFrom) {
      const fromField = record.fields[config.imageFrom];
      if (typeof fromField === 'string' && fromField !== '') {
        const declared = published(fromField);
        if (declared === undefined) {
          delete record.fields[config.imageFrom];
          record.issues.push(`${config.imageFrom}: dropped, the document did not publish that URL`);
        } else {
          record.fields[config.imageFrom] = declared;
        }
      }
    }

    // The hallucination guard: an id the prompt never sent is not a fact about
    // this org's queue. The field goes, the record stays.
    for (const field of ['seriesOf', 'duplicateOf'] as const) {
      const id = record[field];
      if (id !== undefined && !opts.knownIds.has(id)) {
        record[field] = undefined;
        record.issues.push(`${field}: #${id} was not in the list this call carried, so it was ignored`);
        bump('skipped.not_in_list');
      }
    }

    // A note about a series only means anything next to the id it qualifies.
    // AFTER the guard above, which is itself able to clear `seriesOf`: a note
    // kept alongside a dropped id would describe a relationship the card no
    // longer claims.
    if (record.seriesOf === undefined && record.seriesNote !== undefined) {
      record.seriesNote = undefined;
    }

    kept.push(record);
  }

  if (!config.collapseWithinDocument) {
    return { records: kept, counts, notes };
  }

  // One document listing the same thing twice, a listing page with a "featured"
  // block above the calendar, is one record, not two proposals racing for the
  // same dedup key.
  const seen = new Map<string, ValidatedRecord>();
  for (const record of kept) {
    const key = config.dedupOn.map(field => normaliseForKey(record.fields[field])).join('|');
    if (seen.has(key)) {
      counts.collapsed = (counts.collapsed ?? 0) + 1;
      continue;
    }
    seen.set(key, record);
  }
  if (counts.collapsed) {
    notes.push(`${counts.collapsed} record(s) repeated inside the document and were collapsed`);
  }
  return { records: [...seen.values()], counts, notes };
}
