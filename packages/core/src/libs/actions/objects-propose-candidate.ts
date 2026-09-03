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
 * pending item instead of stacking a second copy.
 */

import type { ValidateFunction } from 'ajv';
import type { Action, ActionContext, ReviewCard } from './types';
import { z } from 'zod';

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

const candidateInput = z.object({
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
   * Empty means every proposal is its own item.
   */
  dedupOn: z.array(z.string().min(1)).max(8).default([]),
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

export type CandidateInput = z.infer<typeof candidateInput>;

/**
 * Collapse a value to the part that identifies it: lowercase, accents
 * stripped, punctuation dropped, spaces to hyphens. Two extractions that
 * disagree only on casing or a dash are one candidate.
 * @param value - Any field value; non-strings are stringified first.
 */
function normaliseForKey(value: unknown): string {
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
 * The identity values for a candidate, in the order `dedupOn` names them.
 * A named field that the extractor did not fill still takes a slot, so a
 * missing venue cannot silently merge two different candidates.
 * @param input - The parsed action input.
 */
function identityValues(input: CandidateInput): string[] {
  const values: string[] = [];
  for (const fieldName of input.dedupOn) {
    values.push(normaliseForKey(input.fields[fieldName]));
  }
  return values;
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
function humanise(fieldName: string): string {
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
function displayValue(value: unknown): string {
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

type ObjectTypeRow = {
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
 * @param orgId - The org the candidate belongs to.
 * @param slug - The object type slug from the input.
 */
async function loadObjectType(orgId: string, slug: string): Promise<ObjectTypeRow | null> {
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
    return `${where} ${error.message}`;
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

/**
 * Other candidates of the same type sharing this one's identity prefix but
 * not its full key — the "you have already seen something very like this"
 * flag that exact dedup cannot catch. Scoped to the org.
 * @param orgId - The org whose queue is being rendered.
 * @param input - The parsed action input.
 */
async function findSimilarCandidates(orgId: string, input: CandidateInput): Promise<string[]> {
  const values = identityValues(input);
  if (values.length < 2) {
    // With one identity field there is no "same but for one value" to find.
    return [];
  }
  const { and, eq, inArray, like, ne } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');

  // Hold the first identity value, wildcard the rest. Normalisation leaves
  // only letters, digits and hyphens, so no `%` or `_` can widen this.
  const prefix = `${CANDIDATE_ACTION_ID}:${normaliseForKey(input.objectType)}|${values[0]}|%`;

  // The status filter belongs in the WHERE, not in a loop after it. Filtering
  // ten already-fetched rows would report "nothing similar" whenever the ten
  // newest happened to be rejected, which is exactly when a reviewer most
  // wants to know the same thing has come round before.
  const rows = await db
    .select({ dedupKey: actionRunSchema.dedupKey })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, CANDIDATE_ACTION_ID),
      like(actionRunSchema.dedupKey, prefix),
      ne(actionRunSchema.dedupKey, dedupKeyFrom(input.objectType, values)),
      inArray(actionRunSchema.status, ['pending', 'done']),
    ))
    .limit(10);

  const seen: string[] = [];
  for (const row of rows) {
    const others = (row.dedupKey ?? '').split('|').slice(2).join(' · ');
    seen.push(others || 'an earlier proposal');
  }
  return seen;
}

export const objectProposeCandidateAction: Action<typeof candidateInput> = {
  id: CANDIDATE_ACTION_ID,
  name: 'Propose a record for review',
  description: 'Put one extracted record in front of a human. Approving records the decision; nothing is published from here.',
  inputSchema: candidateInput,
  grant: 'propose_candidate',
  // A decided candidate is what lets something be published outside, so the
  // autonomy gate must hold it for a human. Also on ActionService's
  // never-auto list: no trust rule can clear a candidate unreviewed.
  external: true,

  // Per candidate, never per page. Values are normalised so casing and
  // punctuation drift between two extractions cannot split one thing in two.
  // With no `dedupOn` there is no identity to key on, and no key: keying every
  // candidate of a type the same way would collapse them all into one item.
  dedupKeyFor(input) {
    const values = identityValues(input);
    if (values.length === 0) {
      return undefined;
    }
    return dedupKeyFrom(input.objectType, values);
  },

  // The candidate becomes a real row the moment it is proposed, holding the
  // whole payload and linked to nothing outside.
  async onProposed(ctx, input, runId) {
    await upsertCandidateObject(ctx, input, runId);
  },

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

    // This one is a database round trip, which can genuinely fail. A broken
    // duplicate check must not cost the reviewer the whole card.
    let similar: string[] = [];
    try {
      similar = await findSimilarCandidates(ctx.orgId, input);
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
