/**
 * objects.propose_candidate — an agent proposes one extracted record for a
 * human to decide on. Domain-free by design: core never learns what a venue,
 * a job posting or a grant deadline is.
 *
 * What the caller supplies is an `objectType` slug from the org's own object
 * registry (`business_object_type`, defined in that workspace's YAML) plus a
 * `fields` payload. The type's JSON Schema is the contract; the card is
 * rendered from it. A new domain is a new object type in a workspace, never
 * a new file here.
 *
 * The lifecycle, and why each step is where it is:
 *
 * - **Propose** creates the `business_object` immediately, `status:
 *   'candidate'`, holding the whole payload and pointing at nothing outside.
 *   A candidate is worth keeping whatever the human decides — the rejected
 *   ones are the record of what the extractor got wrong, and they stay
 *   queryable as typed rows instead of being buried in an action's JSON.
 * - **Approve** flips that row to `approved` and, when the approving caller
 *   passes one, stamps the external system's id onto it. Nothing outside is
 *   written from here: the panel that approves is the thing that creates the
 *   downstream record, and it hands back the id in the same decide call, so
 *   the decision and the published record are linked in one step and cannot
 *   half-commit across two systems.
 * - **Reject** flips it to `rejected` and keeps the payload.
 *
 * Dedup is per candidate, never per page: `dedupOn` names the fields that
 * identify the thing, so re-walking a source tomorrow refreshes the one
 * pending item instead of stacking a second copy. `dedupOn` is mandatory —
 * a proposal that leaves it empty, omits it, or nests it inside `fields`
 * fails validation instead of silently storing a keyless row. That used to
 * be legal (empty meant "every proposal is its own item") until a formatting
 * slip by a model — `dedupOn: []` at the top level with the real identity
 * list nested inside `fields` — passed validation, stored `dedup_key` NULL,
 * and permanently duplicated pending rows in a live run (LARK-257). A
 * genuinely one-off candidate now needs a real identity value of its own
 * (a source id, a timestamp) rather than an empty list.
 */

import type { ValidateFunction } from 'ajv';
import type { Action, ActionContext, ReviewCard } from './types';
import { z } from 'zod';
import { isEmptyValue } from '@/libs/workspace/pageFields';

/** The registered id, and the prefix every dedup key carries. */
const CANDIDATE_ACTION_ID = 'objects.propose_candidate';

/** How much of a normalised dedup value survives into the key. */
const DEDUP_SEGMENT_MAX_LENGTH = 80;

/** Lifecycle a proposed object walks. `active` stays the default for objects created any other way. */
export const CANDIDATE_STATUS = {
  proposed: 'candidate',
  approved: 'approved',
  rejected: 'rejected',
} as const;

export const candidateInputShape = z.object({
  /** Slug of an object type in this org's registry, e.g. `event-candidate`. */
  objectType: z.string().min(1).max(200),
  /** What to call this candidate in the queue and on the object row. */
  title: z.string().min(1).max(500),
  /** The extracted payload. Validated against the object type's JSON Schema. */
  fields: z.record(z.string(), z.unknown()).default({}),
  /**
   * Which `fields` keys identify this candidate, in order. `['title',
   * 'start', 'venue']` means those three values are the identity, so a
   * re-scrape that only changed the blurb updates the same queue item.
   *
   * Required — at least one field — and always at the top level of the
   * input, never inside `fields` (`dedupOn` is bookkeeping about the record,
   * not a value on it). Both mistakes are checked below, in `superRefine`,
   * because both need `objectType` to write a message that names the fix.
   */
  dedupOn: z.array(z.string().min(1)).max(8).optional(),
  /** Deep link to the thing itself, where one exists. */
  sourceUrl: z.string().url().optional(),
  /** The page or feed the agent was walking when it found this. */
  sourceListingUrl: z.string().url().optional(),
  /** Illustrative image from the source, shown on the card. */
  imageUrl: z.string().url().optional(),
  /** One-paragraph description, rendered as the card summary. */
  summary: z.string().max(5000).optional(),
  /** What the extractor could not resolve, in words. Shown to the reviewer. */
  extractionNotes: z.string().max(2000).optional(),
  /** Pointer to the stored raw extract this was parsed from, for audit. */
  rawExtractRef: z.string().max(500).optional(),
});

const candidateInput = candidateInputShape.superRefine((value, ctx) => {
  if (!value.dedupOn || value.dedupOn.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dedupOn'],
      message: `dedupOn must list at least one field for "${value.objectType}"; put it at the top level of the input, not inside fields. An empty or missing dedupOn used to mean "every proposal is its own item" — it now stores a keyless row that duplicates whatever is already pending.`,
    });
  }
  if (Object.prototype.hasOwnProperty.call(value.fields, 'dedupOn')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fields', 'dedupOn'],
      message: `dedupOn found inside fields for "${value.objectType}"; it is never a field of the record. Move it to the top level of the input, alongside objectType and title.`,
    });
  }
});

export type CandidateInput = z.infer<typeof candidateInputShape>;

/**
 * The two labels a later stage may write into a record to say it already knows
 * what another queued card is to this one. Parsed back out here so the
 * "Possible duplicate" row can skip a run the card itself already names.
 *
 * Matched by shape rather than by field name on purpose: the field carrying
 * the label is named by the tenant's own config (`seriesLabel.flagField`), and
 * this file never learns a tenant's field names. Any string value on the
 * record may carry one.
 *
 * Exported so the one writer of those labels
 * (`libs/processors/candidateExtractor/labels.ts`) can strip the phrase out of
 * model-written text before it lands on a card. A second copy of this pattern
 * over there would be free to drift, and the drift would be silent: text that
 * still matches here suppresses a duplicate row nobody asked to hide.
 */
export const LABELLED_RUN_ID = /\b(?:part of series|possible duplicate of)\s+#?(\d+)\b/gi;

/**
 * Run ids the payload itself names as an identified series anchor or duplicate.
 * @param fields - The record's extracted payload.
 */
export function labelledRunIds(fields: Record<string, unknown>): number[] {
  const ids = new Set<number>();
  for (const value of Object.values(fields)) {
    if (typeof value !== 'string') {
      continue;
    }
    for (const match of value.matchAll(LABELLED_RUN_ID)) {
      const id = Number.parseInt(match[1] as string, 10);
      if (Number.isFinite(id)) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

/**
 * The identity values inside a stored dedup key, or null when the key is not
 * one of this action's.
 *
 * The key's alphabet is `[a-z0-9-]` after `normaliseForKey`, so `|` can only
 * ever be a separator, splitting it is safe, and segment 0 is
 * `<action>:<type>` rather than an identity value.
 * @param dedupKey - A stored `action_run.dedup_key`.
 */
export function candidateKeySegments(dedupKey: string | null | undefined): { objectType: string; values: string[] } | null {
  if (!dedupKey || !dedupKey.startsWith(`${CANDIDATE_ACTION_ID}:`)) {
    return null;
  }
  const parts = dedupKey.split('|');
  const head = (parts[0] as string).slice(CANDIDATE_ACTION_ID.length + 1);
  return { objectType: head, values: parts.slice(1) };
}

/**
 * Collapse a value to the part that identifies it: lowercase, accents
 * stripped, punctuation dropped, spaces to hyphens. Two extractions that
 * disagree only on casing or a dash are one candidate.
 *
 * Exported because anything comparing a STORED dedup key against a value it
 * holds in memory, the extractor's known-cards block, its sibling rule, has
 * to reproduce this exactly, 80-char slice included. A second implementation
 * would drift the day one of them gained a rule.
 * @param value - Any field value; non-strings are stringified first.
 */
export function normaliseForKey(value: unknown): string {
  const asText = value === null || value === undefined ? '' : String(value);
  const withoutAccents = asText.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const slug = withoutAccents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, DEDUP_SEGMENT_MAX_LENGTH) || 'none';
}

/**
 * The one place the dedup key's shape is written down:
 * `objects.propose_candidate:<type>|<value>|<value>…`.
 * @param objectType - The object type slug.
 * @param values - Already-normalised identity values, in `dedupOn` order.
 */
function dedupKeyFrom(objectType: string, values: string[]): string {
  return `${CANDIDATE_ACTION_ID}:${normaliseForKey(objectType)}|${values.join('|')}`;
}

/**
 * The key one candidate would be stored under, or undefined when it names no
 * identity at all.
 *
 * Exported for the extractor's DRY RUN, which is the first rollout step and
 * whose log line is the only thing a shadow comparison has to diff: to be
 * worth reading it has to print the key the live run would write, byte for
 * byte. Recomputing it there would be a second implementation that drifts the
 * day either one gains a rule, which is the same argument `normaliseForKey`
 * is exported under.
 * @param input - Anything carrying the three values a key is built from.
 */
export function candidateDedupKey(input: Pick<CandidateInput, 'objectType' | 'fields' | 'dedupOn'>): string | undefined {
  const values = identityValues(input);
  if (values.length === 0) {
    return undefined;
  }
  return dedupKeyFrom(input.objectType, values);
}

/**
 * The identity values for a candidate, in the order `dedupOn` names them.
 * A named field that the extractor did not fill still takes a slot, so a
 * missing venue cannot silently merge two different candidates.
 *
 * `input.dedupOn` is required by the input schema for anything that reached
 * here through `propose_candidate` — the `?? []` only guards a caller that
 * builds a `CandidateInput` by hand, bypassing that schema (a direct unit
 * test, for instance).
 * @param input - The parsed action input.
 */
function identityValues(input: Pick<CandidateInput, 'fields' | 'dedupOn'>): string[] {
  const values: string[] = [];
  for (const fieldName of input.dedupOn ?? []) {
    values.push(normaliseForKey(input.fields[fieldName]));
  }
  return values;
}

/**
 * The named identity fields the extractor left blank, in `dedupOn` order.
 * Not itself an error — `identityValues` still holds a slot for it — but a
 * reviewer should see that a candidate's identity rests partly on a blank,
 * since a different candidate missing the same field would look identical
 * on this key alone.
 * @param input - The parsed action input.
 */
function emptyIdentityFields(input: CandidateInput): string[] {
  const empty: string[] = [];
  for (const fieldName of input.dedupOn ?? []) {
    const value = input.fields[fieldName];
    if (value === undefined || value === null || value === '') {
      empty.push(fieldName);
    }
  }
  return empty;
}

/** How a pipeline proposal names the document it was read from. */
const PIPELINE_REF_PREFIX = 'knowledge_document:';

/**
 * A page address as a comparison key: parsed, without its fragment or a
 * trailing slash. Null for anything that is not a URL.
 * @param url - A stored or proposed URL.
 */
function pageKey(url: unknown): string | null {
  if (typeof url !== 'string' || url.trim() === '') {
    return null;
  }
  try {
    const parsed = new URL(url.trim());
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * Whether this payload was read from the record's own page: the page the
 * record links to is the page it was found on.
 * @param input - A candidate payload.
 * @param input.sourceUrl - The record's own page.
 * @param input.sourceListingUrl - The page it was read from.
 */
function readFromItsOwnPage(input: { sourceUrl?: unknown; sourceListingUrl?: unknown }): boolean {
  const own = pageKey(input.sourceUrl);
  return own !== null && own === pageKey(input.sourceListingUrl);
}

/**
 * Whether a source sync proposed this payload, rather than an agent, a chat
 * or the API.
 * @param input - A candidate payload.
 * @param input.rawExtractRef - The stored extract it was parsed from.
 */
function fromPipeline(input: { rawExtractRef?: unknown }): boolean {
  return typeof input.rawExtractRef === 'string' && input.rawExtractRef.startsWith(PIPELINE_REF_PREFIX);
}

/**
 * The fields a proposal declares as labels the pipeline wrote, not read.
 * @param proposal - A proposal in stored shape.
 */
function labelledFields(proposal: Record<string, unknown> | null): Set<string> {
  const labels = proposal?.labels;
  return new Set(Array.isArray(labels) ? labels.filter((name): name is string => typeof name === 'string') : []);
}

/**
 * What an open card stores when the pipeline proposes it again.
 *
 * A listing names an event in a line; its own page says the rest. When a
 * listing re-reads a card its own page wrote, the card keeps what that page
 * said and only gains what it lacked. Everything else replaces the card, as
 * before: its own page re-reading it, an agent or a person correcting it, a
 * card whose identity rests on a blank field (another record may share its
 * key), and a card no page of its own ever wrote.
 * @param previous - The open card's stored input and proposal.
 * @param previous.input - Its stored input.
 * @param previous.proposal - Its stored proposal.
 * @param next - The new proposal.
 * @param next.input - The parsed input.
 * @param next.proposal - The proposal in stored shape.
 */
function refreshCandidate(
  previous: { input: Record<string, unknown>; proposal: Record<string, unknown> | null },
  next: { input: CandidateInput; proposal: Record<string, unknown> | null },
): { input: Record<string, unknown>; proposal: Record<string, unknown> | null } {
  const stored = previous.input as Partial<CandidateInput>;
  const incoming = next.input;
  const storedFields = (stored.fields ?? {}) as Record<string, unknown>;
  const keep = fromPipeline(stored)
    && fromPipeline(incoming)
    && readFromItsOwnPage(stored)
    && !readFromItsOwnPage(incoming)
    && emptyIdentityFields(incoming).length === 0
    && emptyIdentityFields({ ...incoming, fields: storedFields }).length === 0;
  if (!keep) {
    return next;
  }
  const labelled = labelledFields(next.proposal);
  const fields = { ...storedFields };
  for (const [name, value] of Object.entries(incoming.fields)) {
    if (isEmptyValue(fields[name]) && !isEmptyValue(value) && !labelled.has(name)) {
      fields[name] = value;
    }
  }
  const storedUnlessBlank = (name: 'summary' | 'imageUrl' | 'extractionNotes'): unknown =>
    isEmptyValue(stored[name]) ? incoming[name] : stored[name];
  return {
    input: {
      ...incoming,
      title: stored.title ?? incoming.title,
      sourceUrl: stored.sourceUrl,
      sourceListingUrl: stored.sourceListingUrl,
      rawExtractRef: stored.rawExtractRef,
      summary: storedUnlessBlank('summary'),
      imageUrl: storedUnlessBlank('imageUrl'),
      extractionNotes: storedUnlessBlank('extractionNotes'),
      fields,
    },
    proposal: previous.proposal,
  };
}

/**
 * The order the card lists fields in.
 *
 * A workspace controls it with `propertyOrder` on the object type's schema —
 * an array of field names. That exists because the schema is stored as
 * `jsonb`, and Postgres does not keep the author's key order, so the order
 * properties were written in is simply not available to read back. Without
 * `propertyOrder` the fallback is alphabetical, which at least reads the same
 * for every candidate of a type. Fields the schema never mentions come last,
 * also alphabetical, so an extractor's extra key is visible but never
 * displaces the described ones.
 * @param schema - The object type's JSON Schema, or null.
 * @param properties - The schema's `properties` map.
 * @param payload - The extracted fields.
 */
function cardFieldOrder(
  schema: Record<string, unknown> | null,
  properties: Record<string, unknown>,
  payload: Record<string, unknown>,
): string[] {
  const declared = Object.keys(properties);
  const stated = Array.isArray(schema?.propertyOrder) ? (schema.propertyOrder as unknown[]).map(String) : [];

  const described: string[] = [];
  for (const key of stated) {
    if (key in payload && !described.includes(key)) {
      described.push(key);
    }
  }
  for (const key of declared.sort()) {
    if (key in payload && !described.includes(key)) {
      described.push(key);
    }
  }

  const extra = Object.keys(payload).filter(key => !described.includes(key)).sort();
  return [...described, ...extra];
}

/**
 * Human label for a field key the object type does not describe: `venueName` → `Venue Name`.
 * @param fieldName
 */
export function humanise(fieldName: string): string {
  const spaced = fieldName
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Renderable one-line form of a field value. Objects and arrays flatten rather than print `[object Object]`.
 * @param value
 */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(item => displayValue(item)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Hostname of a URL, for a readable link label. Only ever called on the
 * URL-validated input fields, so there is nothing here that can fail to parse.
 * @param url - A URL the input schema already accepted.
 */
function hostLabel(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

export type ObjectTypeRow = {
  id: number;
  slug: string;
  label: string;
  schema: Record<string, unknown> | null;
};

/**
 * Object types, briefly remembered.
 *
 * `reviewCard` runs once per row when a queue page is rendered, and every one
 * of those rows wants the same handful of types. The window is deliberately
 * short: a workspace apply changes a type, and waiting seconds to see it is
 * fine where waiting minutes would not be.
 */
const objectTypeCache = new Map<string, { row: ObjectTypeRow | null; readAt: number }>();

/** How long a remembered object type stays good. One queue render takes milliseconds. */
const OBJECT_TYPE_CACHE_MS = 5_000;

/** Forget everything remembered. For tests, and for a caller that just wrote a type. */
export function forgetCachedObjectTypes(): void {
  objectTypeCache.clear();
}

/**
 * The org's definition of this object type, or null when the workspace has
 * not applied one yet.
 *
 * Exported for `objects.update_meta`, which validates a write against the
 * same type the card is rendered from — one reader, one short memory, so the
 * two actions never disagree about what a type declares.
 * @param orgId - The org the candidate belongs to.
 * @param slug - The object type slug from the input.
 */
export async function loadObjectType(orgId: string, slug: string): Promise<ObjectTypeRow | null> {
  const cacheKey = `${orgId}:${slug}`;
  const remembered = objectTypeCache.get(cacheKey);
  if (remembered && Date.now() - remembered.readAt < OBJECT_TYPE_CACHE_MS) {
    return remembered.row;
  }
  const row = await readObjectType(orgId, slug);
  objectTypeCache.set(cacheKey, { row, readAt: Date.now() });
  return row;
}

/**
 * Read one object type straight from the database, no cache.
 * @param orgId - The org the candidate belongs to.
 * @param slug - The object type slug from the input.
 */
async function readObjectType(orgId: string, slug: string): Promise<ObjectTypeRow | null> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectTypeSchema } = await import('@/models/Schema');

  const [row] = await db
    .select({
      id: businessObjectTypeSchema.id,
      slug: businessObjectTypeSchema.slug,
      label: businessObjectTypeSchema.label,
      schema: businessObjectTypeSchema.schema,
    })
    .from(businessObjectTypeSchema)
    .where(and(
      eq(businessObjectTypeSchema.orgId, orgId),
      eq(businessObjectTypeSchema.slug, slug),
    ))
    .limit(1);

  return row ?? null;
}

/**
 * Compiled validators, keyed by the schema they were built from.
 *
 * Compiling a JSON Schema means generating and evaluating code, and
 * `reviewCard` runs once per row when a queue page is rendered — without this
 * a fifty-item page would compile fifty times. Keying on the schema's own text
 * means a workspace that edits its object type gets a fresh validator with no
 * invalidation step to forget.
 */
const compiledValidators = new Map<string, ValidateFunction | null>();

/** Stop a workspace with many object types from growing the cache without end. */
const MAX_CACHED_VALIDATORS = 200;

/**
 * The validator for a schema, compiled once. `null` means the schema itself is
 * broken — cached too, so a bad object type is not recompiled per row either.
 * @param schema - The object type's JSON Schema.
 */
async function compiledValidatorFor(schema: Record<string, unknown>): Promise<ValidateFunction | null> {
  const key = JSON.stringify(schema);
  const cached = compiledValidators.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const { default: Ajv } = await import('ajv');
  let validate: ValidateFunction | null;
  try {
    validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  } catch (error) {
    // A malformed schema is the workspace's bug, not the candidate's; say so
    // on the card rather than failing the proposal.
    console.error('[objects.propose_candidate] object type schema could not be compiled', error);
    validate = null;
  }

  if (compiledValidators.size >= MAX_CACHED_VALIDATORS) {
    compiledValidators.clear();
  }
  compiledValidators.set(key, validate);
  return validate;
}

/**
 * Check the payload against the object type's JSON Schema and return the
 * problems in plain language. An object type with no schema declares no
 * contract, so nothing can fail it.
 *
 * This is a report, not a gate: a candidate that does not fit still reaches
 * the queue, with the mismatch on its card, because a human deciding on a
 * flawed extraction is more useful than an agent silently dropping it.
 * @param schema - The object type's JSON Schema, or null.
 * @param fields - The extracted payload.
 */
export async function describeSchemaProblems(
  schema: Record<string, unknown> | null,
  fields: Record<string, unknown>,
): Promise<string[]> {
  if (!schema || Object.keys(schema).length === 0) {
    return [];
  }
  const validate = await compiledValidatorFor(schema);
  if (validate === null) {
    return ['the object type\'s schema could not be read, so the payload was not checked'];
  }
  if (validate(fields)) {
    return [];
  }
  return (validate.errors ?? []).map((error) => {
    const where = error.instancePath ? error.instancePath.replace(/^\//, '') : 'the payload';
    // Name the allowed values: "must be equal to one of the allowed values"
    // without them is a refusal the caller cannot act on (backlog 006,
    // 2026-09-25: `surface` refused, the retry guessed again).
    const allowed = error.keyword === 'enum' ? (error.params as { allowedValues?: unknown[] }).allowedValues : undefined;
    return `${where} ${error.message}${Array.isArray(allowed) ? `: ${allowed.map(v => JSON.stringify(v)).join(', ')}` : ''}`;
  });
}

/**
 * Create or refresh the `business_object` row that IS this candidate.
 *
 * Idempotent, and called on every propose — including the one that refreshes
 * an existing pending queue item — so the row never drifts from the payload
 * the reviewer is about to see. Keyed on the review run so a re-propose
 * cannot fork into a second object.
 * @param ctx - Action context; supplies the org.
 * @param input - The parsed action input.
 * @param runId - The action_run this candidate is queued as.
 */
async function upsertCandidateObject(ctx: ActionContext, input: CandidateInput, runId: number): Promise<void> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');

  const objectType = await loadObjectType(ctx.orgId, input.objectType);
  if (!objectType) {
    // Nothing to hang the row off. The queue item still stands, and the card
    // says the type is missing, which is the actionable message.
    console.error(`[objects.propose_candidate] no object type "${input.objectType}" in org ${ctx.orgId}`);
    return;
  }

  // The payload a consumer reads is the record's own fields. Where it came
  // from is bookkeeping and lives in its own column.
  const metadata: Record<string, unknown> = { ...input.fields };
  const provenance: Record<string, unknown> = {
    sourceUrl: input.sourceUrl,
    sourceListingUrl: input.sourceListingUrl,
    rawExtractRef: input.rawExtractRef,
    extractionNotes: input.extractionNotes,
    proposedBy: ctx.invokedBy,
  };

  const [existing] = await db
    .select({ id: businessObjectSchema.id })
    .from(businessObjectSchema)
    .where(and(
      eq(businessObjectSchema.orgId, ctx.orgId),
      eq(businessObjectSchema.reviewActionRunId, runId),
    ))
    .limit(1);

  if (existing) {
    await db
      .update(businessObjectSchema)
      .set({ title: input.title, metadata, provenance, summary: input.summary })
      .where(eq(businessObjectSchema.id, existing.id));
    return;
  }

  await db.insert(businessObjectSchema).values({
    orgId: ctx.orgId,
    typeId: objectType.id,
    title: input.title,
    status: CANDIDATE_STATUS.proposed,
    metadata,
    provenance,
    summary: input.summary,
    reviewActionRunId: runId,
    createdBy: ctx.invokedBy ?? null,
  });
}

/**
 * Move the candidate row to a decided state. Returns the object's id when
 * there was one to move, so `execute` can report what the panel should
 * publish against.
 * @param ctx - Action context; supplies the org.
 * @param runId - The action_run being decided.
 * @param status - The lifecycle state to land on.
 * @param externalRef - The downstream record to link, when approval supplied one.
 * @param externalRef.system
 * @param externalRef.id
 */
async function decideCandidateObject(
  ctx: ActionContext,
  runId: number,
  status: string,
  externalRef?: { system: string; id: string },
): Promise<number | null> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');

  const updates: Record<string, unknown> = { status };
  if (externalRef) {
    updates.externalSystem = externalRef.system;
    updates.externalId = externalRef.id;
  }

  const [updated] = await db
    .update(businessObjectSchema)
    .set(updates)
    .where(and(
      eq(businessObjectSchema.orgId, ctx.orgId),
      eq(businessObjectSchema.reviewActionRunId, runId),
    ))
    .returning({ id: businessObjectSchema.id });

  return updated?.id ?? null;
}

/** One candidate that shares this one's identity prefix. */
export type SimilarCandidate = {
  /** The `action_run` id, so a caller can name it in a label. */
  id: number;
  dedupKey: string | null;
  /** The stored proposal, for reading a field the key does not carry. */
  input: Record<string, unknown>;
  status: string;
};

/** Similar candidates the review card shows, when the caller names no other cap. */
const SIMILAR_CANDIDATE_LIMIT = 10;

/**
 * The `business_object` row a proposal created, by the run it is queued as.
 *
 * `upsertCandidateObject` returns void, so a caller that has just proposed
 * something and wants to hang a document link off the candidate has no id to
 * work with. The lookup rides the unique index on
 * `(org_id, review_action_run_id)`, so it is one row by definition.
 * @param orgId - Org that owns the candidate.
 * @param runId - The `action_run` the candidate is queued as.
 */
export async function candidateObjectIdForRun(orgId: string, runId: number): Promise<number | null> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');

  const [row] = await db
    .select({ id: businessObjectSchema.id })
    .from(businessObjectSchema)
    .where(and(
      eq(businessObjectSchema.orgId, orgId),
      eq(businessObjectSchema.reviewActionRunId, runId),
    ))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Other candidates of the same type sharing this one's identity prefix but
 * not its full key — the "you have already seen something very like this"
 * flag that exact dedup cannot catch. Scoped to the org.
 *
 * Exported because the extractor's sibling rule wants the same query with a
 * bigger cap: a weekly series inside a 60-day horizon is more rows than a
 * review card ever shows, and re-implementing the prefix would put the key's
 * shape in two places.
 * @param orgId - The org whose queue is being rendered.
 * @param input - The parsed action input.
 * @param opts - How this caller differs from the review card.
 * @param opts.limit - Rows to fetch. Defaults to what a card can show.
 * @param opts.excludeRunIds - Runs the caller has already accounted for.
 */
export async function findSimilarCandidates(
  orgId: string,
  input: CandidateInput,
  opts: { limit?: number; excludeRunIds?: number[] } = {},
): Promise<SimilarCandidate[]> {
  const values = identityValues(input);
  if (values.length < 2) {
    // With one identity field there is no "same but for one value" to find.
    return [];
  }
  const { and, eq, inArray, like, ne, notInArray } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');

  // Hold the first identity value, wildcard the rest. Normalisation leaves
  // only letters, digits and hyphens, so no `%` or `_` can widen this.
  const prefix = `${CANDIDATE_ACTION_ID}:${normaliseForKey(input.objectType)}|${values[0]}|%`;

  // The status filter belongs in the WHERE, not in a loop after it. Filtering
  // ten already-fetched rows would report "nothing similar" whenever the ten
  // newest happened to be rejected, which is exactly when a reviewer most
  // wants to know the same thing has come round before.
  //
  // `failed` joins the two: a failed run keeps its card in the queue for
  // retry, so it is every bit as much "already there" as a pending one.
  const excluded = opts.excludeRunIds ?? [];
  const rows = await db
    .select({
      id: actionRunSchema.id,
      dedupKey: actionRunSchema.dedupKey,
      input: actionRunSchema.input,
      status: actionRunSchema.status,
    })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, CANDIDATE_ACTION_ID),
      like(actionRunSchema.dedupKey, prefix),
      ne(actionRunSchema.dedupKey, dedupKeyFrom(input.objectType, values)),
      inArray(actionRunSchema.status, ['pending', 'failed', 'done']),
      ...(excluded.length > 0 ? [notInArray(actionRunSchema.id, excluded)] : []),
    ))
    .limit(opts.limit ?? SIMILAR_CANDIDATE_LIMIT);

  return rows;
}

/**
 * How a similar candidate reads on a card: the identity values that are not
 * the shared first one.
 * @param row - A row from {@link findSimilarCandidates}.
 */
function describeSimilar(row: SimilarCandidate): string {
  const segments = candidateKeySegments(row.dedupKey);
  const others = (segments?.values ?? []).slice(1).join(' \u00B7 ');
  return others || 'an earlier proposal';
}

export const objectProposeCandidateAction: Action<typeof candidateInput> = {
  id: CANDIDATE_ACTION_ID,
  name: 'Propose a record for review',
  description: 'Put one extracted record in front of a human. Approving records the decision; nothing is published from here.',
  inputSchema: candidateInput,
  inputRequired: ['dedupOn'],
  grant: 'propose_candidate',
  // A decided candidate is what lets something be published outside, so the
  // autonomy gate must hold it for a human. Also on ActionService's
  // never-auto list: no trust rule can clear a candidate unreviewed.
  external: true,

  // Per candidate, never per page. Values are normalised so casing and
  // punctuation drift between two extractions cannot split one thing in two.
  // The input schema now requires a non-empty `dedupOn` on everything that
  // reaches here through `propose_candidate`, so `values.length === 0` is
  // unreachable from that path — it stays as a guard for a direct,
  // hand-built `CandidateInput` (a unit test, say), where the same rule
  // applies: no identity, no key, and never a constant in its place, which
  // would collapse every candidate of a type into one queue item.
  dedupKeyFor(input) {
    return candidateDedupKey(input);
  },

  // A candidate is one record a person judges once, and the same listing page
  // is read again every sync — so a record already approved or rejected must
  // not come back as a new card. Without this the queue refills with decided
  // events every pass, and moderating becomes re-deciding.
  //
  // Both decided statuses block, and a decision stands for good. Offering
  // rejected events again means narrowing this to `['done']` or setting
  // `reproposeAfterDays` here — it is one constant for every org, not
  // something a workspace can override.
  dedupAgainstDecided: {
    // A key holding a blank slot is shared by every candidate missing that
    // same field, so a decision on one of them says nothing about the next.
    // Those still reach a reviewer, who has the card's "Dedup field left
    // blank" and "Possible duplicate" rows to tell them apart.
    keyIsTrustworthy: input => emptyIdentityFields(input).length === 0,
  },

  // The candidate becomes a real row the moment it is proposed, holding the
  // whole payload and linked to nothing outside.
  // An object type the org never defined is the one failure worth stopping
  // for. Everything downstream — the stored row, the card's labels, the field
  // order — is built from it, so without it the proposal would become a queue
  // item a reviewer can open but never approve.
  async precheck(ctx, input) {
    const objectType = await loadObjectType(ctx.orgId, input.objectType);
    if (!objectType) {
      return `No object type "${input.objectType}" in this workspace. Propose against a type the workspace defines, or have the type added first.`;
    }
    return undefined;
  },

  async onProposed(ctx, input, runId) {
    await upsertCandidateObject(ctx, input, runId);
  },

  refresh: refreshCandidate,

  // Built from the object type and the payload — core supplies the frame, the
  // workspace supplies the words. Confidence and the queue lane are the card
  // shell's job, from the run itself.
  async reviewCard(ctx, input): Promise<ReviewCard> {
    const objectType = await loadObjectType(ctx.orgId, input.objectType);
    const properties = (objectType?.schema?.properties ?? {}) as Record<string, { title?: string; description?: string }>;

    const fields: Array<{ label: string; value: string; href?: string }> = [];
    const orderedKeys = cardFieldOrder(objectType?.schema ?? null, properties, input.fields);
    for (const key of orderedKeys) {
      const rendered = displayValue(input.fields[key]);
      if (rendered !== '') {
        fields.push({ label: properties[key]?.title ?? humanise(key), value: rendered });
      }
    }

    if (input.sourceUrl) {
      fields.push({ label: 'Source', value: hostLabel(input.sourceUrl), href: input.sourceUrl });
    }
    if (input.sourceListingUrl && input.sourceListingUrl !== input.sourceUrl) {
      fields.push({ label: 'Found on', value: hostLabel(input.sourceListingUrl), href: input.sourceListingUrl });
    }
    if (input.extractionNotes) {
      fields.push({ label: 'Extraction notes', value: input.extractionNotes });
    }

    if (!objectType) {
      fields.push({
        label: 'Unknown record type',
        value: `No object type "${input.objectType}" is defined in this workspace, so nothing was stored for it.`,
      });
    }

    // `describeSchemaProblems` reports a broken schema instead of throwing, so
    // there is nothing to catch here.
    const problems = await describeSchemaProblems(objectType?.schema ?? null, input.fields);
    if (problems.length > 0) {
      fields.push({ label: 'Does not match the record type', value: problems.join('; ') });
    }

    // A warning, not a refusal: the identity slot is still held (see
    // `identityValues`), so this candidate is not a duplicate risk on its
    // own. It is worth a reviewer's attention because a second candidate
    // missing the same field would carry the identical key.
    const blankIdentityFields = emptyIdentityFields(input);
    if (blankIdentityFields.length > 0) {
      fields.push({
        label: 'Dedup field left blank',
        value: `${blankIdentityFields.join(', ')} — part of this candidate's identity, but the extractor left it blank.`,
      });
    }

    // This one is a database round trip, which can genuinely fail. A broken
    // duplicate check must not cost the reviewer the whole card.
    //
    // A card that already says "part of series #41" has had that relationship
    // identified; presenting #41 again as a possible duplicate would tell the
    // reviewer the opposite of what the label says. The ids come off the
    // payload itself, so no configuration reaches this file.
    let similar: string[] = [];
    try {
      const rows = await findSimilarCandidates(ctx.orgId, input, { excludeRunIds: labelledRunIds(input.fields) });
      similar = rows.map(describeSimilar);
    } catch (error) {
      console.error('[objects.propose_candidate] similar-candidate lookup failed', error);
    }
    if (similar.length > 0) {
      fields.push({ label: 'Possible duplicate', value: `Already in the queue: ${similar.join(' / ')}` });
    }

    const typeLabel = objectType?.label ?? humanise(input.objectType);
    const card: ReviewCard = {
      title: input.title,
      system: typeLabel,
      subject: {
        name: input.title,
        role: typeLabel,
        company: input.sourceUrl ? hostLabel(input.sourceUrl) : undefined,
        href: input.sourceUrl,
      },
      provenance: [
        { label: 'Found on', value: input.sourceListingUrl ?? input.sourceUrl ?? 'an unnamed source' },
        { label: 'Extracted from', value: input.rawExtractRef ?? 'the live page' },
      ],
      recommendation: {
        headline: similar.length > 0
          ? `Publish this ${typeLabel.toLowerCase()}, or merge it with the one already queued`
          : `Publish this ${typeLabel.toLowerCase()}`,
        detail: problems.length > 0 ? 'The payload does not match the record type — check the rows above first.' : undefined,
      },
      fields,
      links: input.sourceUrl ? [{ label: 'Open the source', href: input.sourceUrl }] : undefined,
      verbs: { approve: 'Approve', reject: 'Reject' },
      summary: input.summary,
      nextAction: 'Approving marks the candidate approved for the panel to publish. Nothing is written outside from here.',
    };

    if (input.imageUrl) {
      card.contentHeading = { label: 'Source image' };
      card.content = [{
        kind: 'image',
        id: 'source-image',
        label: 'Source image',
        url: input.imageUrl,
        caption: input.title,
      }];
    }

    return card;
  },

  // A rejected candidate keeps its payload — that row is the record of what
  // the extractor got wrong, and the training signal for fixing it.
  async onRejected(ctx, _input, runId) {
    await decideCandidateObject(ctx, runId, CANDIDATE_STATUS.rejected);
  },

  /**
   * Approval. Marks the candidate approved and, when the approving caller
   * named the record it created downstream, links the two. Calls nothing
   * outside: the caller that approves is the one that publishes, so there is
   * no second system to leave half-written.
   * @param ctx - Action context; carries the org and the approval's externalRef.
   * @param input - The decided candidate.
   */
  async execute(ctx, input) {
    const objectId = await decideCandidateObject(
      ctx,
      // `runId` rides the context on execute; without it there is no row to
      // move and the result says so rather than silently succeeding.
      ctx.runId ?? -1,
      CANDIDATE_STATUS.approved,
      ctx.externalRef,
    );

    if (objectId === null) {
      throw new Error(
        `Approved a candidate with no stored record: object type "${input.objectType}" was missing when it was proposed. `
        + 'Apply the workspace object type, then re-propose.',
      );
    }

    return {
      mode: 'recorded',
      objectId,
      objectType: input.objectType,
      title: input.title,
      status: CANDIDATE_STATUS.approved,
      externalSystem: ctx.externalRef?.system ?? null,
      externalId: ctx.externalRef?.id ?? null,
      recordedAt: new Date().toISOString(),
    };
  },
};
