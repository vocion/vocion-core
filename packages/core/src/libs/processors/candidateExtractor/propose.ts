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
import type { SuggestedDecision } from '@/libs/actions/suggestedDecision';
import type { IngestDoc } from '@/services/IngestionService';
import { candidateDedupKey, describeSchemaProblems } from '@/libs/actions/objects-propose-candidate';

/** Extraction notes a card can carry, matching the action's own cap. */
const NOTES_CHAR_CAP = 2000;

/**
 * The model's verdict on one record, or a null pair when the sentence owed
 * alongside it came back empty.
 *
 * The envelope requires both halves, but required only means present: a model
 * answering `""` satisfies the schema, and the card would then carry a verdict
 * with nothing under it — counted in the agreement rate, unreadable by the
 * person it was counted against. Silence is the honest reading of that, and it
 * is the same reading `resolve.ts` takes for a referenced object.
 * @param record - The validated record.
 */
function recordVerdict(record: ValidatedRecord): {
  suggestedDecision: SuggestedDecision | null;
  suggestedDecisionReason: string | null;
} {
  const reason = record.suggestedDecisionReason?.trim();
  if (!reason) {
    return { suggestedDecision: null, suggestedDecisionReason: null };
  }
  return { suggestedDecision: record.suggestedDecision, suggestedDecisionReason: reason };
}

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

export const PROPOSAL_CAP_HIT_NOTE = 'the sync\'s proposal budget is spent, so the rest of this document was not proposed';

export type ProposeOutput = {
  counts: Record<string, number>;
  notes: string[];
  /** The sync's proposal budget ran out before every record was proposed. */
  proposalCapHit: boolean;
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
    return { counts, notes, proposalCapHit: false };
  }

  const { proposeAction } = await import('@/services/ActionService');
  const { addDocumentLink } = await import('@/services/BusinessObjectService');
  const { candidateObjectIdForRun } = await import('@/libs/actions/objects-propose-candidate');

  let proposalCapHit = false;
  for (const record of opts.records) {
    if (!opts.budget.take('maxProposalsPerSync')) {
      notes.push(PROPOSAL_CAP_HIT_NOTE);
      proposalCapHit = true;
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
      //
      // The whole validated `fields` object is on the line, not just the
      // title and the identity values, because a shadow run is judged by
      // diffing the card it WOULD have written against the card a person got,
      // and three of a dozen fields cannot be diffed. `dedupKey` is the live
      // action's own function, over the same three values this `input` hands
      // it, so the line names the row the live run would have created or
      // refreshed rather than something that merely resembles it.
      log('info', 'candidate extractor dry run', {
        orgId: opts.orgId,
        source: opts.sourceSlug,
        objectType: opts.config.objectType,
        title: input.title,
        identity: opts.config.dedupOn.map(field => record.fields[field]),
        dedupKey: candidateDedupKey({
          objectType: opts.config.objectType,
          fields: record.fields,
          dedupOn: opts.config.dedupOn,
        }),
        fields: record.fields,
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
        // What this pipeline decided rather than read, named so the decision
        // can be compared against it. From what `labels.ts` actually wrote,
        // never from the config: a record nothing labelled declares nothing,
        // and a declared field nobody wrote would score as cleared on every
        // approve.
        ...(record.labelledFields?.length ? { labels: record.labelledFields } : {}),
        // What the model thinks should happen to this card, and why, in one
        // sentence. Distinct from `rationale` above: that says where the card
        // came from, this says what to do with it — and for a `reject` the two
        // are nothing alike, because the extraction can be perfect and the
        // record still not belong in the queue.
        //
        // A card the model called a duplicate of a known one is a `reject`
        // whatever it recommended, and the reason says so in core's words
        // rather than the model's: the duplicate id is our determination, and
        // a reviewer reading "duplicate of #412" should be reading a claim we
        // can stand behind. Still only a recommendation — core keeps the card
        // pending for a person and scores agreement against what they do.
        ...(record.duplicateOf !== undefined
          ? {
              suggestedDecision: 'reject' as const,
              suggestedDecisionReason: `Already waiting for review as action run #${record.duplicateOf}.`,
            }
          : recordVerdict(record)),
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

  return { counts, notes, proposalCapHit };
}
