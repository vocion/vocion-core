import type { ProcessorSyncContext } from '../types';
import type { CandidateExtractorConfig } from './config';
import type { ValidatedRecord } from './validate';
import { candidateDedupKey, candidateKeySegments, normaliseForKey } from '@/libs/actions/objects-propose-candidate';
import { defangText } from './knownCards';
import { oncePerSync } from './oncePerSync';

const SCAN_LIMIT = 5_000;

// An open card first, so a rejected twin never takes the refresh from the card being kept.
const ANCHOR_TIERS = [['pending', 'failed'], ['done'], ['rejected']] as const;

export type DocumentCard = {
  runId: number;
  status: string;
  dedupKey: string;
  fields: Record<string, unknown>;
};

async function queryDocumentCards(orgId: string, sourceSlug: string): Promise<Map<string, DocumentCard[]>> {
  const { and, desc, eq, inArray } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema, businessObjectSchema, objectDocumentLinkSchema } = await import('@/models/Schema');

  const rows = await db
    .select({
      document: objectDocumentLinkSchema.onyxDocumentId,
      runId: actionRunSchema.id,
      status: actionRunSchema.status,
      dedupKey: actionRunSchema.dedupKey,
      input: actionRunSchema.input,
    })
    .from(objectDocumentLinkSchema)
    .innerJoin(businessObjectSchema, eq(businessObjectSchema.id, objectDocumentLinkSchema.objectId))
    .innerJoin(actionRunSchema, and(
      eq(actionRunSchema.id, businessObjectSchema.reviewActionRunId),
      eq(actionRunSchema.orgId, businessObjectSchema.orgId),
    ))
    .where(and(
      eq(businessObjectSchema.orgId, orgId),
      eq(objectDocumentLinkSchema.sourceType, sourceSlug),
      eq(actionRunSchema.actionId, 'objects.propose_candidate'),
      inArray(actionRunSchema.status, ANCHOR_TIERS.flat()),
    ))
    .orderBy(desc(actionRunSchema.id))
    .limit(SCAN_LIMIT);

  const byDocument = new Map<string, DocumentCard[]>();
  for (const row of rows) {
    if (!row.dedupKey) {
      continue;
    }
    const cards = byDocument.get(row.document) ?? [];
    cards.push({
      runId: row.runId,
      status: row.status,
      dedupKey: row.dedupKey,
      fields: (row.input?.fields ?? {}) as Record<string, unknown>,
    });
    byDocument.set(row.document, cards);
  }
  return byDocument;
}

export function loadDocumentCards(opts: {
  orgId: string;
  sourceSlug: string;
  config: CandidateExtractorConfig;
  syncContext: ProcessorSyncContext;
}): Promise<Map<string, DocumentCard[]>> {
  if (!opts.config.keepIdentityOnReread) {
    return Promise.resolve(new Map());
  }
  return oncePerSync(opts.syncContext.cache, `documentCards:${opts.sourceSlug}`, () =>
    queryDocumentCards(opts.orgId, opts.sourceSlug));
}

function chooseAnchor(matches: DocumentCard[]): DocumentCard | undefined {
  for (const tier of ANCHOR_TIERS) {
    const inTier = matches.filter(card => (tier as readonly string[]).includes(card.status));
    if (inTier.length > 0) {
      return inTier.reduce((lowest, card) => (card.runId < lowest.runId ? card : lowest));
    }
  }
  return undefined;
}

function noteValue(value: unknown): string {
  return defangText(String(value ?? '')).trim().slice(0, 80);
}

export function keepIdentity(opts: {
  config: CandidateExtractorConfig;
  records: ValidatedRecord[];
  stored: DocumentCard[];
}): Record<string, number> {
  const counts: Record<string, number> = {};
  const rule = opts.config.keepIdentityOnReread;
  if (!rule || opts.stored.length === 0 || opts.records.length === 0) {
    return counts;
  }
  const { objectType, dedupOn } = opts.config;
  const sameIndexes = rule.sameOn.map(field => dedupOn.indexOf(field));
  if (!sameIndexes.every(index => index >= 0)) {
    return counts;
  }
  const bump = (key: string): void => {
    counts[key] = (counts[key] ?? 0) + 1;
  };

  const keyOf = (fields: Record<string, unknown>) => candidateDedupKey({ objectType, fields, dedupOn });
  const keptFields = dedupOn.filter(field => !rule.sameOn.includes(field));
  const wantedType = normaliseForKey(objectType);

  const stored = opts.stored.flatMap((card) => {
    const segments = candidateKeySegments(card.dedupKey);
    return segments?.objectType === wantedType
      ? [{ card, identity: sameIndexes.map(index => segments.values[index]).join('|') }]
      : [];
  });

  const identities = opts.records.map(record => rule.sameOn.map(field => normaliseForKey(record.fields[field])).join('|'));
  const readsOf = new Map<string, number>();
  for (const identity of identities) {
    readsOf.set(identity, (readsOf.get(identity) ?? 0) + 1);
  }

  for (const [index, record] of opts.records.entries()) {
    const identity = identities[index] as string;
    if (readsOf.get(identity) !== 1) {
      continue;
    }
    const matches = stored.filter(entry => entry.identity === identity).map(entry => entry.card);
    const anchor = chooseAnchor(matches);
    const readKey = keyOf(record.fields);
    if (!anchor || readKey === anchor.dedupKey || matches.some(card => card.status !== 'rejected' && card.dedupKey === readKey)) {
      continue;
    }

    const kept = Object.fromEntries(keptFields.map(field => [field, anchor.fields[field]]));
    if (keyOf({ ...record.fields, ...kept }) !== anchor.dedupKey) {
      bump('identity_not_kept');
      continue;
    }

    for (const field of keptFields) {
      if (record.fields[field] !== kept[field]) {
        record.issues.push(`${field}: read as "${noteValue(record.fields[field])}" this time; kept "${noteValue(kept[field])}" from card #${anchor.runId}, which this document filed`);
      }
    }
    Object.assign(record.fields, kept);
    for (const field of ['duplicateOf', 'seriesOf'] as const) {
      if (record[field] === anchor.runId) {
        record[field] = undefined;
        record.issues.push(`${field}: the model matched the card this record refreshes (#${anchor.runId}), so it was ignored`);
        bump('identity_self_match');
      }
    }
    bump('identity_kept');
    if (matches.length > 1) {
      bump('identity_kept_ambiguous');
    }
  }

  return counts;
}
