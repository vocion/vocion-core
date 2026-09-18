/**
 * The `candidate-extractor` model stage: one bounded model call per changed
 * document, then a deterministic pipeline over what it returned.
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
import type { PageLink } from '@/libs/sources/pageMetadata';
import { pushScore } from '@/libs/Langfuse';
import { loadKnownCards } from './knownCards';
import { labelRecords } from './labels';
import { renderLearnings } from './learnings';
import { extractRecords } from './model';
import { buildExtractionPrompt } from './prompt';
import { proposeRecords } from './propose';
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
 * Anything cached for the length of one sync, keyed on the object type.
 * @param cache - The sync-wide cache from the processor context.
 * @param key - Cache key.
 * @param build - Builds the value on a miss.
 */
async function oncePerSync<T>(cache: Map<string, unknown>, key: string, build: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached as T;
  }
  const value = await build();
  cache.set(key, value);
  return value;
}

export const run: DocumentProcessor['run'] = async (ctx): Promise<ProcessorResult> => {
  const config = ctx.config as CandidateExtractorConfig;
  const counts: Record<string, number> = {};
  const notes: string[] = [];
  const today = calendarToday(config.timezone);

  const metadata = (ctx.document.metadata ?? {}) as { jsonLd?: unknown[]; links?: PageLink[]; publishedUrls?: string[] };
  const jsonLdBlocks = metadata.jsonLd ?? [];

  const [known, rules, objectSchema] = await Promise.all([
    loadKnownCards({ orgId: ctx.orgId, config, syncContext: ctx.syncContext, today }),
    oncePerSync(ctx.syncContext.cache, `rules:${config.agentSlug}`, async () =>
      renderLearnings(ctx.orgId, await learningStepsFor(ctx.orgId, config))),
    oncePerSync(ctx.syncContext.cache, `schema:${config.objectType}`, () =>
      loadObjectSchema(ctx.orgId, config.objectType)),
  ]);
  if (rules.failedSteps.length > 0) {
    notes.push(`learning steps that could not be read: ${rules.failedSteps.join(', ')}`);
  }

  const prompt = buildExtractionPrompt({
    config,
    rules: rules.text,
    known: known.text,
    jsonLd: jsonLdBlocks.length > 0 ? JSON.stringify(jsonLdBlocks) : '',
    pageText: ctx.document.content,
    uri: ctx.document.uri,
    maxInputTokens: ctx.budget.caps.maxInputTokensPerCall,
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
    ctx.onProgress({ kind: 'skipped', uri: ctx.document.uri, message: `extraction skipped: ${extraction.reason}` });
    notes.push(`extraction skipped: ${extraction.reason}${extraction.detail ? ` (${extraction.detail})` : ''}`);
    return { produced: 0, skipped: 1, notes, counts };
  }

  counts.found = extraction.records.length;

  const validated = validateRecords({
    records: extraction.records,
    config,
    pageText: ctx.document.content,
    links: metadata.links,
    jsonLd: jsonLdBlocks,
    publishedUrls: metadata.publishedUrls,
    knownIds: known.ids,
    today,
  });
  merge(counts, validated.counts);
  notes.push(...validated.notes);

  const resolved = await resolveRecords({
    orgId: ctx.orgId,
    config,
    records: validated.records,
    syncContext: ctx.syncContext,
  });
  merge(counts, resolved.counts);

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

  return { produced, skipped: Math.max(0, skipped), notes, counts };
};
