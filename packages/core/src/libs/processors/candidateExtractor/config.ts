/**
 * The `candidate-extractor` processor's tenant configuration.
 *
 * Model-free on purpose, and the only module the registry loads eagerly.
 * `libs/workspace/applier.ts` validates a manifest's `processor.config` at
 * apply time and sits in the Temporal worker's static import graph through
 * `MissionService`; if the schema lived next to the model code, validating a
 * manifest would drag LangChain and a Bedrock client into the worker. So this
 * file imports zod and nothing else, and `run.ts` stays behind a dynamic
 * import.
 *
 * Everything here is configuration for rules that run in core. A tenant cannot
 * run code inside the processor, so each rule a tenant needs is expressed as a
 * knob whose name says what it does to a record, never who wants it: the
 * schema names no tenant's concepts.
 *
 * `.strict()` everywhere, at every level. A silently-ignored typo in a config
 * key is a rule the operator believes is in force and is not, the worst
 * failure mode this file has, and the cheapest to prevent.
 */

import { z } from 'zod';

/**
 * How long one DOCUMENT of this processor may take, end to end.
 *
 * Read eagerly by the registry, so it is a plain number here rather than
 * anything derived from the model stage: importing that would drag LangChain
 * into the Temporal worker, which is the whole reason this file exists.
 *
 * 150s is what the work actually costs when it goes well: two model attempts
 * at the 60s default (`SYNC_BUDGET_DEFAULTS.modelTimeoutMs`), the one ticket
 * hop a record may ask for, and writing the proposals. The generic 25s cap it
 * replaces was below a single healthy model call, so every real extraction
 * was abandoned mid-flight.
 */
export const CANDIDATE_EXTRACTOR_DOCUMENT_TIMEOUT_MS = 150_000;

/**
 * A field name on the object type being extracted.
 *
 * Constrained rather than free text because these strings are read back as
 * keys into a record, and because it keeps anything path-shaped out of the
 * config by construction: no processor knob is ever a filesystem path (that is
 * `_manifestDir`'s job, for connectors), so `../` must never parse.
 */
const FieldName = z.string().min(1).max(64).regex(/^[a-z_]\w*$/i, 'must be a field name (letters, digits, underscore)');

/** A slug naming something else in the workspace: an object type, an agent, a learning step. */
const Slug = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/, 'must be a lowercase slug');

/** How a value read from a page is normalised before it is compared. */
const NormaliseRule = z.object({
  /** Words dropped before comparing, "the", "at", venue-type nouns. */
  dropWords: z.array(z.string().min(1)).max(50).optional(),
  /** Literal substitutions applied before comparing, e.g. `&` to `and`. */
  abbreviations: z.record(z.string().min(1), z.string()).optional(),
}).strict();

export const candidateExtractorConfigSchema = z.object({
  /** Business object type the records become candidates for. */
  objectType: Slug,
  /** Agent the proposals are attributed to. Validated against the org's agents at apply time. */
  agentSlug: Slug,
  /**
   * Fields whose values identify a record. They become the dedup key, in this
   * order, so changing the list changes every future key.
   */
  dedupOn: z.array(FieldName).min(1).max(8),
  /** Field whose value is the card's title. */
  titleFrom: FieldName,
  /** The tenant's own extraction rules, in prose, carried in every call. */
  promptFragment: z.string().max(8000),
  /**
   * Learning steps whose adopted rules are read into the prompt. Validated
   * against the org's learning steps at apply time, because `getLearnings`
   * throws on an unknown step and one typo would fail every document.
   */
  learningSteps: z.array(Slug).max(10).optional(),
  /** IANA timezone the date rules are evaluated in. */
  timezone: z.string().min(1).max(64).regex(/^[a-z][\w+-]*(?:\/[\w+-]+)*$/i, 'must be an IANA timezone name').optional(),
  /**
   * Records one document may produce. 200, not 25: a venue's season page lists
   * far more than 25 events, and an answer over the cap is rejected outright
   * rather than trimmed, so the old number quietly cost the whole page.
   */
  maxRecordsPerDocument: z.number().int().positive().max(1_000).default(200),
  /** Records the model is less sure of than this are dropped. */
  minConfidence: z.number().min(0).max(1).default(0.5),
  /** How far ahead a recurring series is expanded, one record per occurrence. */
  recurrenceHorizonDays: z.number().int().positive().max(365).default(60),
  /** Field holding the record's image URL. */
  imageFrom: FieldName.optional(),
  /** The one automatic hop per record, for fields a listing page does not carry. */
  followLinks: z.object({
    enabled: z.boolean().default(false),
    maxPerDocument: z.number().int().positive().max(20).default(10),
    /** Only follow URLs matching this pattern. */
    urlPattern: z.string().min(1).max(500).optional(),
  }).strict().optional(),
  /** Values filled in when the document itself does not name them. */
  defaults: z.record(FieldName, z.union([z.string(), z.number(), z.boolean()])).optional(),
  /**
   * Cards already in review, loaded once per sync and shown to the model so it
   * can say a record is another date of a series or a duplicate of one of them.
   * Empty when the source declares no `defaults[keyedBy]`.
   */
  knownCandidates: z.object({
    /** Field whose value selects which cards are relevant, the source's own venue, say. */
    keyedBy: FieldName,
    /** Field holding the card's date, read from the stored proposal. */
    dateField: FieldName,
    horizonDays: z.number().int().positive().max(365).default(60),
    maxItems: z.number().int().positive().max(500).default(60),
    maxChars: z.number().int().positive().max(20_000).default(4000),
  }).strict().optional(),
  /**
   * A record matching on `sameOn` a card this document already filed takes
   * that card's other `dedupOn` values, so the card is refreshed rather than
   * duplicated.
   */
  keepIdentityOnReread: z.object({
    sameOn: z.array(FieldName).min(1).max(8),
  }).strict().optional(),
  /** Drop a record whose date has already passed, as a calendar day in `timezone`. */
  dropIfPast: z.object({
    field: FieldName,
    /** Keep a record whose start is past while THIS field is still in the future. */
    keepIfField: FieldName.optional(),
  }).strict().optional(),
  /** Per-field enums the model's answer is held to. */
  allowedValues: z.record(FieldName, z.array(z.string().min(1)).min(1)).optional(),
  /** What an out-of-enum value costs: the value, or the whole record. */
  onViolation: z.enum(['dropValue', 'dropRecord']).default('dropValue'),
  /** Fields whose digits must occur in the document, or the field is dropped. */
  mustAppearInDocument: z.array(FieldName).max(20).optional(),
  /** Collapse records that share the `dedupOn` identity within one document. */
  collapseWithinDocument: z.boolean().default(false),
  /** Canonicalise printed values against approved objects of another type. */
  resolveAgainst: z.array(z.object({
    objectType: Slug,
    /** Record field to object field. */
    matchFields: z.record(FieldName, FieldName),
    /** Per-field normalisation, keyed exactly like `matchFields`: a name and a town do not share rules. */
    normalise: z.record(FieldName, NormaliseRule).optional(),
    /** Copy the matched object's values over the printed ones. */
    copyOnMatch: z.boolean().default(true),
  }).strict()).max(5).optional(),
  /** Other candidates to propose alongside each record, a venue before its events. */
  relatedProposals: z.array(z.object({
    objectType: Slug,
    /** Field on the proposed object to the record field it reads. */
    fromFields: z.record(FieldName, FieldName),
    dedupOn: z.array(FieldName).min(1).max(8),
    /** Record field the proposal's run id is written back into. */
    writeRunIdTo: FieldName,
    oncePerRun: z.boolean().default(true),
    /** Skip when the record already resolved against an approved object. */
    skipIfResolved: z.boolean().default(true),
  }).strict()).max(5).optional(),
  /**
   * The deterministic sibling check behind the model's own answer: same
   * identity on `sameOn`, a different value on `differsOn`.
   */
  seriesLabel: z.object({
    sameOn: z.array(FieldName).min(1).max(8),
    differsOn: FieldName,
    /** Field whose non-empty value on the anchor is evidence of a series. */
    evidenceField: FieldName.optional(),
    /** Field the label is written into. */
    flagField: FieldName,
    /**
     * Field the group key is written into, so a reader can show every
     * occurrence of one series together.
     *
     * The value is the run id of the FIRST card of the group, as a bare
     * decimal string, and it is root-normalised at write time: a record whose
     * anchor already carries a key inherits that key rather than pointing at
     * the anchor, so a chain of occurrences collapses to one group in one hop
     * and no consumer ever walks it.
     *
     * The anchor itself is never written to and carries no key, because
     * nothing in this pipeline refreshes another card. That is deliberate, and
     * it is why the key is the anchor's own run id rather than a synthetic
     * value: the whole group is `fields[keyField] || String(card.id)`, which
     * answers for the anchor and its followers with one comparison.
     *
     * Not part of the record's identity, so it never belongs in `dedupOn`.
     * That one is cross-field against the rest of the config and is checked
     * where the rest of the identity-relative knobs are, in
     * `libs/sources/upsert.ts`.
     */
    keyField: FieldName.optional(),
    maxAnchors: z.number().int().positive().max(200).default(40),
  }).strict().superRefine((series, ctx) => {
    // Three jobs, three fields: the label sentence, the group key, and the
    // recurrence text an anchor is recognised by. Point two of them at one
    // field and the later write silently erases the earlier one, which is the
    // same failure `.strict()` exists to prevent, one level up.
    if (series.keyField !== undefined && series.keyField === series.flagField) {
      ctx.addIssue({
        code: 'custom',
        path: ['keyField'],
        message: `seriesLabel.keyField "${series.keyField}" is also its flagField; the group key would overwrite the label sentence`,
      });
    }
    if (series.keyField !== undefined && series.keyField === series.evidenceField) {
      ctx.addIssue({
        code: 'custom',
        path: ['keyField'],
        message: `seriesLabel.keyField "${series.keyField}" is also its evidenceField; the group key would overwrite the recurrence text an anchor is recognised by`,
      });
    }
  }).optional(),
  /** Named 0..1 judgements the model adds to every record, each with the operator's rubric. */
  scores: z.array(z.object({
    name: FieldName,
    describe: z.string().min(1).max(400),
  }).strict()).max(4).optional().refine(
    scores => !scores || new Set(scores.map(score => score.name)).size === scores.length,
    { message: 'score names must be unique' },
  ),
  /**
   * Lower this sync's spending caps. Every value is optional and may only
   * LOWER the code default, see `libs/processors/budget.ts`.
   */
  limits: z.object({
    maxPages: z.number().int().nonnegative().optional(),
    maxDetailHops: z.number().int().nonnegative().optional(),
    maxModelCalls: z.number().int().nonnegative().optional(),
    maxInputTokensPerCall: z.number().int().nonnegative().optional(),
    modelTimeoutMs: z.number().int().nonnegative().optional(),
    maxInputTokensPerSync: z.number().int().nonnegative().optional(),
    maxProposalsPerSync: z.number().int().nonnegative().optional(),
    maxWallClockMs: z.number().int().nonnegative().optional(),
  }).strict().optional(),
  /** Do everything except write the proposals. */
  dryRun: z.boolean().default(false),
}).strict();

export type CandidateExtractorConfig = z.infer<typeof candidateExtractorConfigSchema>;
