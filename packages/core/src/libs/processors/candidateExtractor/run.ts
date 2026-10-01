/**
 * The `candidate-extractor` model stage: one bounded model call per changed or
 * retried document, then a deterministic pipeline over what it returned.
 *
 *   known cards (once per sync) ─┐
 *   adopted rules (once per sync)─┼─> prompt ─> ONE model call ─> records
 *   page text + JSON-LD ─────────┘                                  │
 *                                                                   v
 *     validate (gates + operator knobs) ─> resolve (canonicalise, propose the
 *     venue) ─> label (series / duplicate) ─> propose one candidate per record
 *
 * There is no deterministic field mapper in front of the model, by decision:
 * the object type's own field names are what the model is asked for, and every
 * tenant rule that used to live in a mapper is a configuration knob that
 * validates what came back instead of extracting it.
 *
 * Nothing in this tree reads a path. `_manifestDir` is the connectors' affair;
 * a processor's config is values only, and `readFile` appears nowhere under
 * `candidateExtractor/`.
 *
 * This file is reached ONLY through the registry's dynamic `import()`. That is
 * what keeps LangChain and the Bedrock client out of the Temporal worker's
 * static graph, and `scripts/temporal-worker.imports.test.ts` fails if it ever
 * stops being true.
 */

import type { DocumentProcessor, ProcessorResult } from '../types';
import type { CandidateExtractorConfig } from './config';
import type { CalendarEntry } from './occurrences';
import type { PageLink } from '@/libs/sources/pageMetadata';
import { pushScore } from '@/libs/Langfuse';
import { icsOverriddenInstant, icsOwnValues, icsRecurrence, icsRepeats } from '@/libs/sources/web';
import { expandRecurrence, readRule, ruleEndedBefore } from '@/libs/time/recurrence';
import { dayKey, dayPlus, endOfDay, resolveTimeZone, startOfDay } from '@/libs/time/zone';
import { keepIdentity, loadDocumentCards } from './identity';
import { loadKnownCards } from './knownCards';
import { labelRecords } from './labels';
import { renderLearnings } from './learnings';
import { extractRecords, SKIP_OUTCOME } from './model';
import { entryDateText, LOOKAHEAD_DAYS, nextOccurrence, wallZoneOf } from './occurrences';
import { oncePerSync } from './oncePerSync';
import { buildExtractionPrompt } from './prompt';
import { PROPOSAL_CAP_HIT_NOTE, proposeRecords } from './propose';
import { proposeRelatedObjects, resolveRecords } from './resolve';
import { calendarToday, validateRecords } from './validate';

/**
 * Merge a stage's counters into the document's.
 * @param into - The document's accumulator.
 * @param from - One stage's counts.
 */
function merge(into: Record<string, number>, from: Record<string, number>): void {
  for (const [key, value] of Object.entries(from)) {
    into[key] = (into[key] ?? 0) + value;
  }
}

/**
 * The object type's JSON Schema, loaded once per sync.
 *
 * Only used for the report-only check on each payload, so a type that has no
 * schema, or a read that fails, costs a note, never a candidate.
 * @param orgId - Org whose registry is read.
 * @param objectType - Object type slug.
 */
async function loadObjectSchema(orgId: string, objectType: string): Promise<Record<string, unknown> | null> {
  try {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { businessObjectTypeSchema } = await import('@/models/Schema');
    const [row] = await db
      .select({ schema: businessObjectTypeSchema.schema })
      .from(businessObjectTypeSchema)
      .where(and(eq(businessObjectTypeSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, objectType)))
      .limit(1);
    return (row?.schema ?? null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

/**
 * The learning steps to read: the processor's own list, else the agent's.
 * @param orgId - Org whose agent row is read.
 * @param config - The source's processor config.
 */
async function learningStepsFor(orgId: string, config: CandidateExtractorConfig): Promise<string[]> {
  if (config.learningSteps && config.learningSteps.length > 0) {
    return config.learningSteps;
  }
  try {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { agentSchema } = await import('@/models/Schema');
    const [agent] = await db
      .select({ steps: agentSchema.learningSteps })
      .from(agentSchema)
      .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, config.agentSlug)))
      .limit(1);
    return agent?.steps ?? [];
  } catch {
    return [];
  }
}

/**
 * The document as a split calendar component, or undefined when it is not one.
 * @param content - the entry as the model reads it.
 * @param metadata - the entry's stored metadata.
 * @param metadata.feedUrl - the feed a split entry came from.
 * @param metadata.calendarZone - the zone the calendar declares.
 * @param metadata.overridden - the instances the feed writes as components of their own, as `splitIcs` stored them.
 * @param config - the processor config.
 * @param today - the run's day.
 */
function calendarEntry(content: string, metadata: { feedUrl?: string; calendarZone?: string; overridden?: unknown }, config: CandidateExtractorConfig, today: string): CalendarEntry | undefined {
  // A split calendar component, recognised by its text the way `splitFeed` in the web connector recognises the feed.
  if (typeof metadata.feedUrl !== 'string' || !/^BEGIN:VEVENT/i.test(content)) {
    return undefined;
  }
  const zone = resolveTimeZone(metadata.calendarZone, config.timezone);
  const lines = content.split('\n');
  const rec = icsRecurrence(lines, zone);
  const stored = Array.isArray(metadata.overridden) ? metadata.overridden.filter((v): v is string => typeof v === 'string') : [];
  const replaced = new Set(rec ? stored.map(v => icsOverriddenInstant(v, rec)?.getTime()).filter((t): t is number => t !== undefined) : []);
  return { lines, zone, rec, replaced, from: startOfDay(today, zone), to: endOfDay(dayPlus(today, config.recurrenceHorizonDays), zone) };
}

/**
 * The dates a repeating calendar entry falls on inside the horizon, for the
 * prompt, or undefined when the document is not one or its rule is not read.
 * @param entry - the document as a calendar entry.
 */
function repeatingEntryDates(entry: CalendarEntry | undefined): string[] | undefined {
  if (!entry?.rec) {
    return undefined;
  }
  const { rec, zone, replaced, from, to } = entry;
  const dates = expandRecurrence({ ...rec, from, to }).filter(d => !replaced.has(d.getTime()));
  if (dates.length === 0) {
    return undefined;
  }
  return dates.map(d => entryDateText(d, rec, zone));
}

/**
 * The start of the day a series is read again: the day its next date past the
 * horizon comes inside it, but no sooner than half a horizon on, and at least
 * a day.
 * @param day - the day that date comes inside the horizon, `YYYY-MM-DD`.
 * @param config - the processor config.
 * @param today - the run's day.
 */
function revisitOn(day: string, config: CandidateExtractorConfig, today: string): Date {
  const soonest = dayPlus(today, Math.max(1, Math.floor(config.recurrenceHorizonDays / 2)));
  return startOfDay(day > soonest ? day : soonest, resolveTimeZone(config.timezone));
}

/**
 * When a repeating calendar entry's reading goes stale. A rule the expander
 * does not read is read again every half horizon until it has plainly ended.
 * Undefined for a one-off entry, a series with nothing left past the horizon,
 * and any other document.
 * @param entry - the document as a calendar entry.
 * @param config - the processor config.
 * @param today - the run's day.
 */
function revisitTime(entry: CalendarEntry | undefined, config: CandidateExtractorConfig, today: string): Date | undefined {
  if (!entry) {
    return undefined;
  }
  const horizon = config.recurrenceHorizonDays;
  const rule = entry.rec && readRule(entry.rec.rule);
  if (!entry.rec || !rule) {
    const start = icsOwnValues(entry.lines, 'DTSTART')[0];
    return icsOwnValues(entry.lines, 'RRULE').some(r => !ruleEndedBefore(r, today, start)) ? revisitOn(today, config, today) : undefined;
  }
  const next = nextOccurrence(entry.rec, new Date(entry.to.getTime() + 1), entry.zone, d => entry.replaced.has(d.getTime()));
  if (next) {
    return revisitOn(dayPlus(dayKey(next, entry.zone), -horizon), config, today);
  }
  // An interval too long to reach in the search has not ended; one with a COUNT or an UNTIL has.
  return rule.count === undefined && rule.until === undefined ? revisitOn(dayPlus(today, LOOKAHEAD_DAYS), config, today) : undefined;
}

export const run: DocumentProcessor['run'] = async (ctx): Promise<ProcessorResult> => {
  const config = ctx.config as CandidateExtractorConfig;
  const counts: Record<string, number> = {};
  const notes: string[] = [];

  // Nothing it found could be proposed, so a model call now would be spent for nothing.
  if (ctx.budget.spent.maxProposalsPerSync >= ctx.budget.caps.maxProposalsPerSync) {
    return { produced: 0, skipped: 1, notes: [PROPOSAL_CAP_HIT_NOTE], counts, retry: { reason: PROPOSAL_CAP_HIT_NOTE, countsAsTry: false } };
  }
  const today = calendarToday(config.timezone);

  const metadata = (ctx.document.metadata ?? {}) as {
    jsonLd?: unknown[];
    jsonLdInText?: boolean;
    links?: PageLink[];
    publishedUrls?: string[];
    ogImage?: string;
    images?: string[];
    feedUrl?: string;
    entryUrl?: unknown;
    endsOn?: string;
    calendarZone?: string;
    overridden?: unknown;
  };

  const entry = calendarEntry(ctx.document.content, metadata, config, today);
  const revisitAt = revisitTime(entry, config, today);
  const stale = revisitAt ? { revisitAt } : {};

  // A one-off entry that ended two days ago or more can only yield past
  // records, which `dropIfPast` would drop after paying for them. One day of
  // margin covers a feed whose zone differs from the configured one.
  if (config.dropIfPast && typeof metadata.endsOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(metadata.endsOn) && metadata.endsOn < dayPlus(today, -1)) {
    counts['skipped.past_before_call'] = 1;
    return { produced: 0, skipped: 1, notes: [`the entry ended on ${metadata.endsOn}, so it was not read`], counts, ...stale };
  }
  const jsonLdBlocks = metadata.jsonLd ?? [];

  const [known, rules, objectSchema, documentCards] = await Promise.all([
    loadKnownCards({ orgId: ctx.orgId, config, syncContext: ctx.syncContext, today }),
    oncePerSync(ctx.syncContext.cache, `rules:${config.agentSlug}`, async () =>
      renderLearnings(ctx.orgId, await learningStepsFor(ctx.orgId, config))),
    oncePerSync(ctx.syncContext.cache, `schema:${config.objectType}`, () =>
      loadObjectSchema(ctx.orgId, config.objectType)),
    loadDocumentCards({ orgId: ctx.orgId, sourceSlug: ctx.sourceSlug, config, syncContext: ctx.syncContext }),
  ]);
  if (rules.failedSteps.length > 0) {
    notes.push(`learning steps that could not be read: ${rules.failedSteps.join(', ')}`);
  }

  // Under `occurrenceFields` a series the expander reads is written from its
  // own rule after the call, so the call is told only its next date; one it
  // does not read is left to the model, and counted.
  const feedSeries = config.occurrenceFields && entry?.rec && readRule(entry.rec.rule) ? { ...entry, rec: entry.rec } : undefined;
  if (config.occurrenceFields && entry && !feedSeries && icsRepeats(entry.lines)) {
    counts['expansion.feed_rule_unread'] = 1;
  }
  let nextDate: string | undefined;
  if (feedSeries) {
    const wallZone = wallZoneOf(feedSeries.rec, config);
    const next = nextOccurrence(feedSeries.rec, startOfDay(today, wallZone), wallZone, d => feedSeries.replaced.has(d.getTime()));
    nextDate = next && entryDateText(next, feedSeries.rec, wallZone);
  }
  const prompt = buildExtractionPrompt({
    config,
    rules: rules.text,
    known: known.text,
    ...(config.occurrenceFields ? { nextDate } : { occurrences: repeatingEntryDates(entry) }),
    // Sent on its own only when the page text does not already carry it whole.
    jsonLd: jsonLdBlocks.length > 0 && metadata.jsonLdInText !== true ? JSON.stringify(jsonLdBlocks) : '',
    pageText: ctx.document.content,
    uri: ctx.document.uri,
    ogImage: metadata.ogImage,
    maxInputTokens: ctx.budget.caps.maxInputTokensPerCall,
    today,
  });
  if (prompt.trimmed.length > 0) {
    notes.push(`the call did not fit its token budget, so these were trimmed: ${prompt.trimmed.join(', ')}`);
  }

  const extraction = await extractRecords({
    orgId: ctx.orgId,
    sourceSlug: ctx.sourceSlug,
    config,
    prompt,
    budget: ctx.budget,
    signal: ctx.signal,
    trace: {
      uri: ctx.document.uri,
      bytes: ctx.document.content.length,
      jsonLdBlocks: jsonLdBlocks.length,
      knownCards: known.cards.length,
    },
  });
  counts.model_calls = extraction.calls;

  if (extraction.status === 'skipped') {
    counts[extraction.reason] = (counts[extraction.reason] ?? 0) + 1;
    pushScore({ traceId: extraction.traceId, name: 'extraction-ok', value: 0 });
    const skipMessage = `extraction skipped: ${extraction.reason}${extraction.detail ? ` (${extraction.detail})` : ''}`;
    ctx.onProgress({ kind: 'skipped', uri: ctx.document.uri, message: skipMessage });
    notes.push(skipMessage);
    const outcome = SKIP_OUTCOME[extraction.reason];
    const retry = outcome === 'finished' ? undefined : { reason: skipMessage, countsAsTry: outcome === 'retry' };
    return { produced: 0, skipped: 1, notes, counts, ...(retry ? { retry } : stale) };
  }

  counts.found = extraction.records.length;

  const validated = validateRecords({
    records: extraction.records,
    config,
    pageText: ctx.document.content,
    links: metadata.links,
    jsonLd: jsonLdBlocks,
    publishedUrls: metadata.publishedUrls,
    // The feed a split entry came from, and only that. An ICS event travels,
    // so its feed is not reliably its base (see `splitIcs`), and an HTML page
    // already resolves its own links in the connector.
    baseUrl: metadata.feedUrl,
    ownUrl: ctx.document.uri,
    entryUrl: typeof metadata.entryUrl === 'string' ? metadata.entryUrl : undefined,
    // The document's own image, declared to the gate so a model that returned
    // it is believed. The same value is stated in the prompt above, because
    // the connector keeps it out of `content`: that text is hashed to decide
    // the document changed, and a dated image URL would change it daily.
    ogImage: metadata.ogImage,
    images: metadata.images,
    knownIds: known.ids,
    today,
    rules: rules.rules,
    feedSeries,
    calendarEntry: entry !== undefined,
  });
  merge(counts, validated.counts);
  // A calendar entry's own records are replaced by the computed ones, so they are not found twice.
  counts.found += (validated.counts.expanded ?? 0) - (validated.counts['expansion.replaced'] ?? 0);
  notes.push(...validated.notes);

  const resolved = await resolveRecords({
    orgId: ctx.orgId,
    config,
    records: validated.records,
    syncContext: ctx.syncContext,
  });
  merge(counts, resolved.counts);
  merge(counts, keepIdentity({ config, records: validated.records, stored: documentCards.get(ctx.document.externalId) ?? [] }));

  merge(counts, await proposeRelatedObjects({
    orgId: ctx.orgId,
    config,
    records: validated.records,
    resolved: resolved.resolved,
    syncContext: ctx.syncContext,
    evidence: ctx.document.uri,
    dryRun: config.dryRun,
  }));

  merge(counts, await labelRecords({ orgId: ctx.orgId, config, records: validated.records, known }));

  const proposed = await proposeRecords({
    orgId: ctx.orgId,
    sourceSlug: ctx.sourceSlug,
    config,
    records: validated.records,
    document: ctx.document,
    documentId: ctx.outcome.documentId,
    objectSchema,
    learningIds: rules.ids,
    budget: ctx.budget,
  });
  merge(counts, proposed.counts);
  notes.push(...proposed.notes);

  const produced = (counts.proposed ?? 0) + (counts.refreshed ?? 0);
  const skipped = counts.found - produced - (counts.already_decided ?? 0);

  // One score per document, so a run's extraction health is filterable in
  // Langfuse without reading the counters.
  pushScore({ traceId: extraction.traceId, name: 'extraction-ok', value: produced > 0 ? 1 : 0 });

  // A rule's dates no record was written for are read again when they come inside the horizon.
  const stated = validated.nextUnwritten && revisitOn(dayPlus(validated.nextUnwritten, -config.recurrenceHorizonDays), config, today);
  const due = stated && (!revisitAt || stated < revisitAt) ? { revisitAt: stated } : stale;
  const retry = proposed.proposalCapHit ? { reason: PROPOSAL_CAP_HIT_NOTE, countsAsTry: true } : undefined;
  return { produced, skipped: Math.max(0, skipped), notes, counts, ...(retry ? { retry } : due) };
};
