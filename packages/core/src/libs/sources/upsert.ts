/**
 * Writing a source row, from whichever writer holds the pen.
 *
 * There are two, and they must not drift: `libs/workspace/applier.ts` writes
 * the sources a workspace manifest declares, and `POST /api/v1/sources` writes
 * the sources a tenant's own system of record declares (Veerio's Strapi mirrors
 * every ingestable venue through it). Both mean the same thing by "upsert",
 * find by `(orgId, slug)`, validate the connector's config and the processor's,
 * REPLACE the stored blob including the `_connector` / `_processor` stamps, then
 * make the source's two Temporal schedules match what was declared, so the
 * logic lives here once instead of being written twice and diverging on the
 * third change.
 *
 * What this is deliberately NOT: `addSource`, the picker path's find-or-create.
 * That returns the existing row untouched when the slug is taken, so a writer
 * mirroring a CHANGED source would get a cheerful success and store nothing.
 *
 * The blob holds the AUTHORED config, not the parsed one: storing defaults
 * would bake today's default into every row, so changing one later would
 * rewrite every source and trigger a full re-sync of all of them.
 */

import type { ProcessorRef } from '@/libs/sources/processor';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { listProcessorSlugs, processorConfigSchema } from '@/libs/processors/registry';
import { withManifestDir } from '@/libs/sources/manifestDir';
import { withProcessor } from '@/libs/sources/processor';
import { getConnector, listConnectors } from '@/libs/sources/registry';
import { agentSchema, knowledgeSourceSchema, learningStepSchema } from '@/models/Schema';

/**
 * Config key holding a source's human-readable name.
 *
 * Same reserved-key convention as `_connector`, `_manifestDir` and
 * `_processor`, and here for the same reason: a tenant mirroring its own
 * records wants the panel to say "Higher Ground", not `veerio-higher-ground`,
 * and `knowledge_source` has no name column. A workspace manifest declares no
 * name at all, so a manifest-written source simply carries no key and reads
 * back as its slug, which is what it displayed before this existed.
 */
const SOURCE_NAME_KEY = '_name';

/**
 * A source's display name: what the writer supplied, else its slug.
 * @param config - The stored source config (may carry `_name`).
 * @param slug - The source's slug, used when no name was supplied.
 */
export function sourceNameOf(config: Record<string, unknown> | undefined, slug: string): string {
  const declared = config?.[SOURCE_NAME_KEY];
  return typeof declared === 'string' && declared.trim().length > 0 ? declared : slug;
}

/** What a writer declares about one source. The manifest shape, minus its file. */
export type SourceUpsertSpec = {
  slug: string;
  /** Human-readable name. Omitted = the slug is the name. */
  name?: string;
  /** Connector kind, must name a registered connector. */
  kind: string;
  /** The authored per-connector config, validated against the connector's schema. */
  config: Record<string, unknown>;
  enabled: boolean;
  /** Cron for the recurring INCREMENTAL sync. Manual-only when omitted. */
  schedule?: string;
  /**
   * Cron for the recurring FULL reconcile. Omitted = the connector's
   * `defaultReconcileCron`; an explicit `false` disables the pass.
   */
  reconcileSchedule?: string | false;
  /** A document processor to run over every ingested document, and its config. */
  processor?: { slug: string; config: Record<string, unknown> };
  /** Per-connection ACL. Omitted = org-wide. */
  access?: { visibility?: 'org' | 'restricted'; users?: string[] } | null;
  /** Absolute directory of the manifest that declared this source, when one did. */
  manifestDir?: string;
};

export type SourceUpsertOutcome = 'created' | 'updated' | 'unchanged';

/** The org's existing names a processor's config may reference. */
export type KnownProcessorNames = {
  learningSteps: Set<string>;
  agentSlugs: Set<string>;
};

/**
 * The learning steps and agents already stored for an org.
 *
 * The applier unions these with the ones the manifest being applied is about to
 * create, because an apply may declare a step and the source that uses it in
 * one pass. An API caller has no such pass: it can only name what is already
 * there.
 * @param orgId - Org whose names to read.
 */
export async function storedProcessorNames(orgId: string): Promise<KnownProcessorNames> {
  const [steps, agents] = await Promise.all([
    db.select({ name: learningStepSchema.name }).from(learningStepSchema).where(eq(learningStepSchema.orgId, orgId)),
    db.select({ slug: agentSchema.slug }).from(agentSchema).where(eq(agentSchema.orgId, orgId)),
  ]);
  return {
    learningSteps: new Set(steps.map(r => r.name)),
    agentSlugs: new Set(agents.map(r => r.slug)),
  };
}

/**
 * Validate a source's `processor` block, and return what gets stamped into
 * `config_json`.
 *
 * Everything checked here would otherwise fail at run time, once per document,
 * for as long as nobody noticed: `getLearnings` throws on an unknown step, and
 * a mistyped agent slug degrades the learning loop silently.
 * @param spec - The source declaring the processor.
 * @param known - What its config may name.
 */
export function validateSourceProcessor(spec: SourceUpsertSpec, known: KnownProcessorNames): ProcessorRef | undefined {
  if (!spec.processor) {
    return undefined;
  }
  const schema = processorConfigSchema(spec.processor.slug);
  if (!schema) {
    throw new Error(`source "${spec.slug}" references unknown processor: "${spec.processor.slug}". Registered: ${listProcessorSlugs().join(', ')}`);
  }
  // Throws ZodError on bad input, same as the connector config below.
  const parsed = schema.parse(spec.processor.config) as { learningSteps?: string[]; agentSlug?: string };
  for (const step of parsed.learningSteps ?? []) {
    if (!known.learningSteps.has(step)) {
      throw new Error(`source "${spec.slug}" processor names unknown learning step: "${step}"`);
    }
  }
  if (parsed.agentSlug && !known.agentSlugs.has(parsed.agentSlug)) {
    throw new Error(`source "${spec.slug}" processor names unknown agent: "${parsed.agentSlug}"`);
  }
  return { slug: spec.processor.slug, config: spec.processor.config };
}

/**
 * Create or replace one source row.
 *
 * Returns `unchanged` when the stored row already equals what was declared, so
 * a re-mirror of an untouched source neither writes nor triggers the full sync
 * a config change earns.
 * @param orgId - Org that owns the source.
 * @param spec - What the writer declared.
 * @param opts - Validation inputs and the dry-run switch.
 * @param opts.known - The org's learning steps and agents a processor may name.
 * @param opts.dryRun - Report the outcome without writing.
 */
export async function upsertSourceRow(
  orgId: string,
  spec: SourceUpsertSpec,
  opts: { known: KnownProcessorNames; dryRun?: boolean },
): Promise<{ outcome: SourceUpsertOutcome; id: number | null }> {
  const connector = getConnector(spec.kind);
  if (!connector) {
    throw new Error(`source "${spec.slug}" references unknown connector kind: "${spec.kind}". Registered: ${listConnectors().map(c => c.slug).join(', ')}`);
  }
  // Validate the per-connector config blob. Throws ZodError on bad input.
  connector.configSchema.parse(spec.config);
  const processor = validateSourceProcessor(spec, opts.known);

  const [existing] = await db
    .select()
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.slug, spec.slug)));

  // `_connector` routes `runSync` to the right connector; `_manifestDir` lets a
  // connector resolve a relative path against the manifest that declared the
  // source; `_processor` names the per-document stage; `_name` is what a panel
  // shows. All four are reserved keys inside the stored blob rather than
  // columns, and all four are written by whoever holds the pen, this path
  // replaces the blob wholesale.
  const named = spec.name?.trim()
    ? { ...spec.config, [SOURCE_NAME_KEY]: spec.name.trim() }
    : { ...spec.config };
  const payload = {
    orgId,
    slug: spec.slug,
    kind: 'plugin' as const,
    configJson: withProcessor(
      withManifestDir({ ...named, _connector: spec.kind }, spec.manifestDir),
      processor,
    ) as Record<string, unknown>,
    accessPolicy: spec.access ?? null,
    enabled: String(spec.enabled),
  };

  if (!existing) {
    if (opts.dryRun) {
      return { outcome: 'created', id: null };
    }
    const [row] = await db.insert(knowledgeSourceSchema).values(payload).returning({ id: knowledgeSourceSchema.id });
    return { outcome: 'created', id: row?.id ?? null };
  }

  if (
    existing.slug === payload.slug
    && existing.kind === payload.kind
    && existing.enabled === payload.enabled
    && canonical(existing.configJson) === canonical(payload.configJson)
    && canonical(existing.accessPolicy ?? null) === canonical(payload.accessPolicy)
  ) {
    return { outcome: 'unchanged', id: existing.id };
  }

  if (!opts.dryRun) {
    await db.update(knowledgeSourceSchema).set(payload).where(eq(knowledgeSourceSchema.id, existing.id));
  }
  return { outcome: 'updated', id: existing.id };
}

/**
 * Make the source's two Temporal schedules match what was declared: the
 * incremental cron and the full-sync reconcile. A disabled source, or one with
 * no cron, has its schedule removed rather than left firing at a row nobody
 * wants synced, that is the rollback path, since no writer here deletes rows.
 *
 * Talks to Temporal, so callers that can survive without a schedule (the
 * applier collects the failure and carries on) must catch.
 * @param orgId - Org that owns the source.
 * @param spec - What the writer declared.
 * @param sourceId - The stored row's id, or null when there is no row to point a schedule at.
 */
export async function reconcileSourceSchedules(
  orgId: string,
  spec: SourceUpsertSpec,
  sourceId: number | null,
): Promise<void> {
  const {
    ensureSourceSchedule,
    removeSourceSchedule,
    ensureSourceReconcileSchedule,
    removeSourceReconcileSchedule,
  } = await import('@/services/SourceScheduleService');

  if (spec.enabled && spec.schedule && sourceId !== null) {
    await ensureSourceSchedule({ orgId, sourceId, sourceSlug: spec.slug, cron: spec.schedule });
  } else {
    await removeSourceSchedule(orgId, spec.slug);
  }

  // Second cadence: the full-sync reconcile that prunes upstream deletions.
  // An explicit cron wins; the connector's default applies when omitted; an
  // explicit `false` disables the pass.
  const reconcileCron = spec.reconcileSchedule === false
    ? undefined
    : (spec.reconcileSchedule ?? getConnector(spec.kind)?.defaultReconcileCron);
  if (spec.enabled && reconcileCron && sourceId !== null) {
    await ensureSourceReconcileSchedule({ orgId, sourceId, sourceSlug: spec.slug, cron: reconcileCron });
  } else {
    await removeSourceReconcileSchedule(orgId, spec.slug);
  }
}

/**
 * Key-order-independent JSON, so a re-serialised blob is not read as a change.
 * @param v - The value to stabilise.
 */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value as object).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  });
}
