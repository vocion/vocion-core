/**
 * Turning validated records into review candidates.
 *
 * One `proposeAction` per record, and the outcome it returns, `created`,
 * `refreshed`, `already_decided`, is the run's whole report on what the pass
 * achieved. Nothing here decides whether a record is new: the action's dedup
 * key does, which is why no record ever passes an explicit `dedupKey`.
 *
 * Two things are deliberately defensive:
 *
 *   - **The document link is best-effort.** `addDocumentLink` is a second
 *     write after the candidate exists; letting it throw would lose a
 *     candidate a person could have reviewed, to gain a provenance row.
 *   - **`dryRun` computes everything and writes nothing.** It is the first
 *     rollout step, so it has to exercise the same code, the same fields, the
 *     same key, the same labels, and stop one call short.
 */

import type { SyncBudget } from '../budget';
import type { CandidateExtractorConfig } from './config';
import type { ValidatedRecord } from './validate';
import type { IngestDoc } from '@/services/IngestionService';
import { describeSchemaProblems } from '@/libs/actions/objects-propose-candidate';

/** Extraction notes a card can carry, matching the action's own cap. */
const NOTES_CHAR_CAP = 2000;

/**
 * Log through a deferred import, never a static one.
 *
 * `libs/Logger` has a top-level await, which is fatal under the Temporal
 * worker's CommonJS compile. This module is only ever reached through the
 * registry's dynamic import, but the habit is the rule in this repo and the
 * cost is nothing.
 * @param level - Log level.
 * @param message - Log message.
 * @param properties - Structured fields.
 */
function log(level: 'info' | 'warn', message: string, properties: Record<string, unknown>): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    .catch(() => {});
}

export type ProposeOutput = {
  counts: Record<string, number>;
  notes: string[];
};

/**
 * Propose one document's records.
 * @param opts - Everything a proposal is built from.
 * @param opts.orgId - Org the candidates belong to.
 * @param opts.sourceSlug - Source slug, recorded on the document link.
 * @param opts.config - The source's processor config.
 * @param opts.records - Validated, resolved and labelled records.
 * @param opts.document - The document they came from.
 * @param opts.documentId - Its `knowledge_document` id, for `rawExtractRef`.
 * @param opts.objectSchema - The object type's JSON Schema, for the report-only check.
 * @param opts.learningIds - Rule ids the prompt carried, echoed onto the card.
 * @param opts.budget - The sync's shared caps.
 */
export async function proposeRecords(opts: {
  orgId: string;
  sourceSlug: string;
  config: CandidateExtractorConfig;
  records: ValidatedRecord[];
  document: IngestDoc;
  documentId: number;
  objectSchema: Record<string, unknown> | null;
  learningIds: string[];
  budget: SyncBudget;
}): Promise<ProposeOutput> {
  const counts: Record<string, number> = {};
  const notes: string[] = [];
  const bump = (key: string, by = 1): void => {
    counts[key] = (counts[key] ?? 0) + by;
  };
  if (opts.records.length === 0) {
    return { counts, notes };
  }

  const { proposeAction } = await import('@/services/ActionService');
  const { addDocumentLink } = await import('@/services/BusinessObjectService');
  const { candidateObjectIdForRun } = await import('@/libs/actions/objects-propose-candidate');

  for (const record of opts.records) {
    if (!opts.budget.take('maxProposalsPerSync')) {
      notes.push('the sync\'s proposal budget is spent, so the rest of this document was not proposed');
      break;
    }

    // Report only, exactly as the action itself treats a schema mismatch: a
    // human deciding on a flawed extraction beats an agent dropping it.
    const problems = await describeSchemaProblems(opts.objectSchema, record.fields);
    const extractionNotes = [
      ...record.issues,
      ...(problems.length > 0 ? [`does not match the record type: ${problems.join('; ')}`] : []),
      ...(record.notes ? [record.notes] : []),
      ...(opts.learningIds.length > 0 ? [`rules applied: ${opts.learningIds.join(', ')}`] : []),
    ].join('. ').slice(0, NOTES_CHAR_CAP);

    const input: Record<string, unknown> = {
      objectType: opts.config.objectType,
      title: String(record.fields[opts.config.titleFrom] ?? ''),
      fields: record.fields,
      dedupOn: opts.config.dedupOn,
      ...(record.sourceUrl ? { sourceUrl: record.sourceUrl } : {}),
      ...(opts.document.uri ? { sourceListingUrl: opts.document.uri } : {}),
      ...(record.imageUrl ? { imageUrl: record.imageUrl } : {}),
      ...(extractionNotes ? { extractionNotes } : {}),
      rawExtractRef: `knowledge_document:${opts.documentId}`,
    };

    if (opts.config.dryRun) {
      // One structured line per would-be candidate: the dry run's entire
      // output, and what the first rollout step is read from.
      log('info', 'candidate extractor dry run', {
        orgId: opts.orgId,
        source: opts.sourceSlug,
        objectType: opts.config.objectType,
        title: input.title,
        identity: opts.config.dedupOn.map(field => record.fields[field]),
        confidence: record.confidence,
        document: opts.document.uri ?? opts.document.externalId,
      });
      bump('dry_run');
      continue;
    }

    const proposed = await proposeAction({
      orgId: opts.orgId,
      actionId: 'objects.propose_candidate',
      input,
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
        rationale: `Extracted from ${opts.document.uri ?? opts.document.externalId} during a source sync.`,
        evidence: opts.document.uri ? [opts.document.uri] : undefined,
        agentSlug: opts.config.agentSlug,
        // A card the model called a duplicate of a known one is a recommendation
        // to turn it down; core keeps such a card pending for a person and only
        // scores agreement with what the reviewer does. Everything else carries
        // no recommendation until a measured threshold says approve is safe.
        ...(record.duplicateOf !== undefined ? { suggestedDecision: 'reject' as const } : {}),
      },
    });

    if (proposed.outcome === 'created') {
      bump('proposed');
    } else if (proposed.outcome === 'refreshed') {
      bump('refreshed');
    } else {
      bump('already_decided');
      // A decided record has no object to link this document to, and it is not
      // an error: it is the queue behaving.
      continue;
    }

    try {
      const objectId = await candidateObjectIdForRun(opts.orgId, proposed.runId);
      if (objectId !== null) {
        await addDocumentLink({
          objectId,
          onyxDocumentId: opts.document.externalId,
          sourceType: opts.sourceSlug,
          semanticIdentifier: opts.document.title ?? String(input.title),
          link: opts.document.uri ?? '',
          role: 'source',
        }, opts.orgId);
      }
    } catch (error) {
      // Provenance is worth having and never worth a candidate.
      bump('link_failures');
      log('warn', 'candidate extractor could not link its document', {
        orgId: opts.orgId,
        source: opts.sourceSlug,
        runId: proposed.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { counts, notes };
}
