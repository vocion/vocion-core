/**
 * Canonicalising a printed value against what the workspace already approved,
 * and proposing the thing it could not find.
 *
 * Two knobs, and the order between them matters:
 *
 *   - `resolveAgainst`, the record printed "Higher Ground Ballroom, S.
 *     Burlington" and the workspace already has an approved venue called
 *     "Higher Ground" in "South Burlington". Match them, and copy the approved
 *     values over the printed ones, so every card for that venue carries the
 *     same spelling.
 *   - `relatedProposals`, no match. Propose the venue ONCE for this sync,
 *     before the records that reference it, and thread its run id onto each of
 *     them so a reviewer approving the venue can see what is waiting on it.
 *
 * The normalisation is **per field**, keyed exactly like `matchFields`,
 * because the tenant system it mirrors is per field: drop words and `&` apply
 * to a NAME, `s.` and `n.` apply to a TOWN. One shared normaliser would
 * silently widen both, and a venue in "North Street" would become one in
 * "north" territory. Core's own `normaliseForKey` does none of this, it turns
 * `S. Burlington` into `s-burlington`, which is exactly why this knob exists
 * rather than reusing the key.
 */

import type { ProcessorSyncContext } from '../types';
import type { CandidateExtractorConfig } from './config';
import type { ValidatedRecord } from './validate';
import type { SuggestedDecision } from '@/libs/actions/suggestedDecision';
import { CANDIDATE_STATUS, normaliseForKey } from '@/libs/actions/objects-propose-candidate';

/** How a value is compared, per the rule's `normalise` block for that field. */
type NormaliseRule = {
  dropWords?: string[];
  abbreviations?: Record<string, string>;
};

/** One approved object, as the resolver compares it. */
type ApprovedObject = {
  title: string;
  fields: Record<string, unknown>;
};

/**
 * Escape a literal for use inside a regular expression.
 * @param text - The literal to escape.
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Collapse a value the way the tenant's own matcher does, then the way the
 * dedup key does, so the answer is comparable on both sides.
 * @param value - The printed value.
 * @param rule - The per-field normalise block, if the config declared one.
 */
export function normaliseForMatch(value: unknown, rule: NormaliseRule | undefined): string {
  let text = String(value ?? '').toLowerCase();
  for (const [from, to] of Object.entries(rule?.abbreviations ?? {})) {
    // Left boundary only: `s.` has to match at the start of a word, but its
    // own trailing dot is not a word character, so `\b` after it never fires.
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(from.toLowerCase())}`, 'gu'), to.toLowerCase());
  }
  const drop = new Set((rule?.dropWords ?? []).map(word => word.toLowerCase()));
  const kept = text.split(/\s+/).filter(token => token !== '' && !drop.has(token.replace(/[^\p{L}\p{N}&]/gu, '')));
  return normaliseForKey(kept.join(' '));
}

/**
 * Every approved object of a type, loaded once per sync.
 * @param opts - Where to read from.
 * @param opts.orgId - Org whose objects are read.
 * @param opts.objectType - Object type slug.
 * @param opts.syncContext - Shared across every document of this sync.
 */
async function approvedObjects(opts: {
  orgId: string;
  objectType: string;
  syncContext: ProcessorSyncContext;
}): Promise<ApprovedObject[]> {
  const cacheKey = `approved:${opts.objectType}`;
  const cached = opts.syncContext.cache.get(cacheKey);
  if (cached) {
    return cached as ApprovedObject[];
  }

  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');

  const rows = await db
    .select({ title: businessObjectSchema.title, metadata: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectSchema.typeId, businessObjectTypeSchema.id))
    .where(and(
      eq(businessObjectSchema.orgId, opts.orgId),
      eq(businessObjectTypeSchema.slug, opts.objectType),
      eq(businessObjectSchema.status, CANDIDATE_STATUS.approved),
    ));

  const objects: ApprovedObject[] = rows.map(row => ({
    title: row.title ?? '',
    fields: (row.metadata ?? {}) as Record<string, unknown>,
  }));
  opts.syncContext.cache.set(cacheKey, objects);
  return objects;
}

export type ResolveOutput = {
  counts: Record<string, number>;
  /** Record indexes that matched an approved object, for `skipIfResolved`. */
  resolved: Set<number>;
};

/**
 * Canonicalise each record against the approved objects the config names.
 * @param opts - What to resolve and against what.
 * @param opts.orgId - Org whose objects are read.
 * @param opts.config - The source's processor config.
 * @param opts.records - Validated records, mutated in place on a match.
 * @param opts.syncContext - Shared across every document of this sync.
 */
export async function resolveRecords(opts: {
  orgId: string;
  config: CandidateExtractorConfig;
  records: ValidatedRecord[];
  syncContext: ProcessorSyncContext;
}): Promise<ResolveOutput> {
  const counts: Record<string, number> = {};
  const resolved = new Set<number>();
  const rules = opts.config.resolveAgainst ?? [];
  if (rules.length === 0 || opts.records.length === 0) {
    return { counts, resolved };
  }

  for (const rule of rules) {
    const objects = await approvedObjects({
      orgId: opts.orgId,
      objectType: rule.objectType,
      syncContext: opts.syncContext,
    });
    if (objects.length === 0) {
      continue;
    }
    const pairs = Object.entries(rule.matchFields);

    for (const [index, record] of opts.records.entries()) {
      const wanted = pairs.map(([recordField]) => normaliseForMatch(record.fields[recordField], rule.normalise?.[recordField]));
      if (wanted.some(value => value === '' || value === 'none')) {
        continue;
      }
      const hit = objects.find(object => pairs.every(([recordField, objectField], slot) =>
        normaliseForMatch(object.fields[objectField], rule.normalise?.[recordField]) === wanted[slot]));
      if (!hit) {
        continue;
      }
      resolved.add(index);
      counts['venues.matched'] = (counts['venues.matched'] ?? 0) + 1;
      if (rule.copyOnMatch) {
        // Verbatim, so every card for this venue reads identically.
        for (const [recordField, objectField] of pairs) {
          const canonical = hit.fields[objectField];
          if (canonical !== undefined && canonical !== null && canonical !== '') {
            record.fields[recordField] = canonical;
          }
        }
      }
    }
  }

  return { counts, resolved };
}

/**
 * The recommendation and reason for one referenced object, as the model
 * returned them, or a null pair when it judged the record but not the object.
 *
 * Both keys are always present, because the proposal envelope requires the
 * question to be answered and takes null for "nothing judged this" — see
 * `ActionService.proposeAction`.
 * @param record - The record naming the object.
 * @param objectType - The `relatedProposals` rule's object type.
 */
function verdictFor(
  record: ValidatedRecord,
  objectType: string,
): { suggestedDecision: SuggestedDecision | null; suggestedDecisionReason: string | null } {
  const verdict = record.referencedObjects?.find(entry => entry.objectType === objectType);
  if (!verdict || !verdict.suggestedDecisionReason.trim()) {
    return { suggestedDecision: null, suggestedDecisionReason: null };
  }
  return {
    suggestedDecision: verdict.suggestedDecision,
    suggestedDecisionReason: verdict.suggestedDecisionReason,
  };
}

/**
 * Propose the related objects the records reference and the workspace does not
 * have, once per sync each, and thread each proposal's run id onto the records
 * that named it.
 *
 * Deliberately before the records themselves: a reviewer who opens the venue
 * first sees what is waiting on it, and the run id is on every card either way.
 * @param opts - What to propose and for whom.
 * @param opts.orgId - Org the proposals belong to.
 * @param opts.config - The source's processor config.
 * @param opts.records - Validated records, mutated with the run id.
 * @param opts.resolved - Indexes that already matched an approved object.
 * @param opts.syncContext - Shared across every document of this sync.
 * @param opts.evidence - Document uri, for the proposal envelope.
 * @param opts.dryRun - Compute everything, write nothing.
 */
export async function proposeRelatedObjects(opts: {
  orgId: string;
  config: CandidateExtractorConfig;
  records: ValidatedRecord[];
  resolved: Set<number>;
  syncContext: ProcessorSyncContext;
  evidence?: string;
  dryRun: boolean;
}): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const rules = opts.config.relatedProposals ?? [];
  if (rules.length === 0 || opts.records.length === 0) {
    return counts;
  }
  const { proposeAction } = await import('@/services/ActionService');

  for (const rule of rules) {
    for (const [index, record] of opts.records.entries()) {
      if (rule.skipIfResolved && opts.resolved.has(index)) {
        continue;
      }
      const fields: Record<string, unknown> = {};
      for (const [objectField, recordField] of Object.entries(rule.fromFields)) {
        const value = record.fields[recordField];
        if (value !== undefined && value !== null && value !== '') {
          fields[objectField] = value;
        }
      }
      if (rule.dedupOn.some(field => fields[field] === undefined)) {
        // Nothing to identify it by; the record keeps its printed values.
        continue;
      }

      const identity = rule.dedupOn.map(field => normaliseForKey(fields[field])).join('|');
      const cacheKey = `related:${rule.objectType}:${identity}`;
      let runId = rule.oncePerRun ? (opts.syncContext.cache.get(cacheKey) as number | undefined) : undefined;

      if (runId === undefined) {
        if (opts.dryRun) {
          continue;
        }
        const proposed = await proposeAction({
          orgId: opts.orgId,
          actionId: 'objects.propose_candidate',
          input: {
            objectType: rule.objectType,
            title: String(fields[rule.dedupOn[0] as string] ?? 'Unnamed'),
            fields,
            dedupOn: rule.dedupOn,
            ...(opts.evidence ? { sourceListingUrl: opts.evidence } : {}),
          },
          principal: {
            kind: 'agent',
            id: `agent:${opts.config.agentSlug}`,
            scope: { orgId: opts.orgId },
            grants: ['*'],
            autonomy: 2,
          },
          invokedBy: `agent:${opts.config.agentSlug}`,
          proposal: {
            confidence: record.confidence,
            rationale: 'Referenced by a record extracted from this source, and not yet an approved object.',
            evidence: opts.evidence ? [opts.evidence] : undefined,
            agentSlug: opts.config.agentSlug,
            // The model's own verdict on this object, made in the same call
            // that read the document (see `prompt.ts`'s referenced-objects
            // policy). Null when it judged the record but not the object: a
            // card that says nothing is honest, and core inventing an
            // "approve" here scored in the agreement rate as though a model
            // had made it.
            ...verdictFor(record, rule.objectType),
          },
        });
        runId = proposed.runId;
        if (proposed.outcome === 'created') {
          counts['venues.proposed'] = (counts['venues.proposed'] ?? 0) + 1;
        }
        if (rule.oncePerRun) {
          opts.syncContext.cache.set(cacheKey, runId);
        }
      }

      record.fields[rule.writeRunIdTo] = runId;
    }
  }

  return counts;
}
