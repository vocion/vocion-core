import type { RecordLinker } from '@/libs/workspace/recordHref';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { NO_RECORD_PAGES, recordLinker } from '@/libs/workspace/recordHref';
import { actionRunSchema, askSchema, businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';
import { inboxHref } from '@/services/inbox/inboxRef';

/**
 * THE REVIEW QUEUE STAYS TRUE (backlog 039).
 *
 * Prod, 2026-09-28: the product-manager was refused its planning for holding
 * "8 undecided items in Review" while Review itself showed the whole
 * workspace 9. Seven of the eight had been retired from Review two days
 * earlier by expiry and never closed; three were plans a person had already
 * approved on the plan's own record, whose review runs nobody told. The limit
 * was counting rows whose reason had gone.
 *
 * An undecided item is still TRUE while the thing it waits on is still
 * waiting. It is GONE, with a reason a person can check in one move, when:
 *
 *   expired      — it passed its `expires_at`, so it already left Review
 *   record gone  — the record it acts on or asks about was deleted
 *   decided      — it is the review of a candidate record, and that record
 *                  was decided on its own page (no longer `candidate`, or its
 *                  type's settled field says so)
 *   settled      — it is a QUESTION (an ask, or a proposal to file one) and
 *                  every record it is about has settled: shipped, answered,
 *                  out of scope, merged. A write is not closed this way: a
 *                  "tell the asker it shipped" is still owed after it ships.
 *   superseded   — a newer item of the same action carries the same dedup key
 *
 * "Settled" is the workspace's word, never core's: an object type declares
 * `x-settled: {field, in: [...]}` on its schema (principle 7 — the next kind
 * costs a descriptor). Core knows only its own lifecycle: a record `rejected`
 * or `archived` has settled.
 *
 * The sweep closes a gone item — a run as `closed` (not `rejected`: nobody
 * decided, and the trust ladder, scorecards and `onRejected` hooks must not
 * read it as a no), an ask as `superseded` — with "closed: <why>" and the link
 * to the evidence, on the decided tab where a person can see it. It never
 * touches an item that is still true. A true item older than the bound is
 * surfaced once instead of piling up: the row says "still waiting since …"
 * and an ask is notified again.
 *
 * The same verdict decides what the proposal limit counts
 * (`ProposalBudgetService.openProposals`), so the limit and the queue agree.
 */

/** Who closes: shown as the decider on every row the sweep closes. */
export const REVIEW_SWEEPER = 'system:review-sweep';

/** An action run's status once the sweep closed it. */
export const CLOSED_STATUS = 'closed';

/** A true item older than this is surfaced once. `VOCION_REVIEW_STILL_WAITING_DAYS` overrides. */
export function stillWaitingAfterMs(): number {
  const days = Number(process.env.VOCION_REVIEW_STILL_WAITING_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : 7) * 86_400_000;
}

export type Truth
  = | { true: true }
    | { true: false; why: string; link: string | null; at?: Date; expired?: true };

export type RunForTruth = {
  id: number;
  orgId: string;
  actionId: string;
  input: Record<string, unknown> | null;
  dedupKey: string | null;
  expiresAt: Date | null;
  createdAt: Date;
};

export type AskForTruth = {
  id: number;
  orgId: string;
  objectRefs: Array<{ type: string; id: string }> | null;
};

type TypeInfo = { id: number; slug: string; label: string; settled: { field: string; in: string[] } | null };
type RecordInfo = { id: number; typeId: number; title: string; status: string | null; metadata: Record<string, unknown> | null; reviewRunId: number | null };

/**
 * The type schema's `x-settled` descriptor, or null when it declares none (or a malformed one).
 * @param schema
 */
export function settledDescriptor(schema: unknown): { field: string; in: string[] } | null {
  const raw = (schema as Record<string, unknown> | null)?.['x-settled'] as { field?: unknown; in?: unknown } | undefined;
  if (!raw || typeof raw.field !== 'string' || !Array.isArray(raw.in)) {
    return null;
  }
  const values = raw.in.filter((v): v is string => typeof v === 'string');
  return values.length > 0 ? { field: raw.field, in: values } : null;
}

/** Core's own lifecycle: a record in one of these has settled, whatever its type says. */
const SETTLED_RECORD_STATUSES = new Set(['rejected', 'archived']);

/**
 * Has this record settled? Returns the value that says so, or null.
 * @param rec - The record.
 * @param type - Its type.
 */
function settledValue(rec: RecordInfo, type: TypeInfo | undefined): string | null {
  if (rec.status && SETTLED_RECORD_STATUSES.has(rec.status)) {
    return rec.status;
  }
  const d = type?.settled;
  if (!d) {
    return null;
  }
  const raw = rec.metadata?.[d.field] ?? (d.field === 'status' ? rec.status : undefined);
  return typeof raw === 'string' && d.in.includes(raw) ? raw : null;
}

/** The action a candidate record's review is made with. */
const CANDIDATE_ACTION = 'objects.propose_candidate';

/** A proposal to file an ask is a question, like the ask itself. */
const QUESTION_ACTIONS = new Set(['ask.file']);

/**
 * The typed record refs a run names: `objectRefs` in its input, or the `id` an `objects.*` write targets.
 * @param run
 */
function runRefs(run: RunForTruth): Array<{ type: string | null; id: number }> {
  const input = run.input ?? {};
  const out: Array<{ type: string | null; id: number }> = [];
  for (const ref of Array.isArray(input.objectRefs) ? input.objectRefs as Array<{ type?: unknown; id?: unknown }> : []) {
    const id = Number(ref?.id);
    if (typeof ref?.type === 'string' && Number.isInteger(id) && id > 0) {
      out.push({ type: ref.type, id });
    }
  }
  if (run.actionId.startsWith('objects.') && run.actionId !== CANDIDATE_ACTION) {
    const id = Number(input.id);
    if (Number.isInteger(id) && id > 0) {
      out.push({ type: null, id });
    }
  }
  return out;
}

function askRefs(ask: AskForTruth): Array<{ type: string; id: number }> {
  return (ask.objectRefs ?? [])
    .map(r => ({ type: r.type, id: Number(r.id) }))
    .filter(r => typeof r.type === 'string' && Number.isInteger(r.id) && r.id > 0);
}

/**
 * Everything the verdicts read for one org, in four queries however many items.
 * @param orgId
 * @param runs
 * @param asks
 * @param link
 */
async function loadFacts(orgId: string, runs: RunForTruth[], asks: AskForTruth[], link: RecordLinker) {
  const types = await db
    .select({ id: businessObjectTypeSchema.id, slug: businessObjectTypeSchema.slug, label: businessObjectTypeSchema.label, schema: businessObjectTypeSchema.schema })
    .from(businessObjectTypeSchema)
    .where(eq(businessObjectTypeSchema.orgId, orgId));
  const typeById = new Map<number, TypeInfo>();
  const typeBySlug = new Map<string, TypeInfo>();
  for (const t of types) {
    const info = { id: t.id, slug: t.slug, label: t.label, settled: settledDescriptor(t.schema) };
    typeById.set(t.id, info);
    typeBySlug.set(t.slug, info);
  }

  const ids = new Set<number>();
  for (const r of runs) {
    runRefs(r).forEach(ref => ids.add(ref.id));
  }
  for (const a of asks) {
    askRefs(a).forEach(ref => ids.add(ref.id));
  }
  const candidateRunIds = runs.filter(r => r.actionId === CANDIDATE_ACTION).map(r => r.id);
  const recordCols = {
    id: businessObjectSchema.id,
    typeId: businessObjectSchema.typeId,
    title: businessObjectSchema.title,
    status: businessObjectSchema.status,
    metadata: businessObjectSchema.metadata,
    reviewRunId: businessObjectSchema.reviewActionRunId,
  };
  const [byId, byReview] = await Promise.all([
    ids.size > 0
      ? db.select(recordCols).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, [...ids])))
      : Promise.resolve([] as RecordInfo[]),
    candidateRunIds.length > 0
      ? db.select(recordCols).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.reviewActionRunId, candidateRunIds)))
      : Promise.resolve([] as RecordInfo[]),
  ]);
  const records = new Map<number, RecordInfo>(byId.map(r => [r.id, r as RecordInfo]));
  const candidateOf = new Map<number, RecordInfo>(byReview.filter(r => r.reviewRunId !== null).map(r => [r.reviewRunId!, r as RecordInfo]));

  // The newest item per (action, dedup key): an older one with the same key
  // was superseded by it, whatever became of the newer one.
  const keyed = runs.filter(r => r.dedupKey);
  const newest = new Map<string, number>();
  if (keyed.length > 0) {
    const rows = await db
      .select({ actionId: actionRunSchema.actionId, dedupKey: actionRunSchema.dedupKey, id: sql<number>`max(${actionRunSchema.id})::int` })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), inArray(actionRunSchema.dedupKey, [...new Set(keyed.map(r => r.dedupKey!))])))
      .groupBy(actionRunSchema.actionId, actionRunSchema.dedupKey);
    for (const row of rows) {
      newest.set(`${row.actionId}\u0000${row.dedupKey}`, Number(row.id));
    }
  }
  const href = (rec: RecordInfo) => link({ objectType: typeById.get(rec.typeId)?.slug ?? null, id: rec.id });
  return { typeById, typeBySlug, records, candidateOf, newest, href };
}

type Facts = Awaited<ReturnType<typeof loadFacts>>;

function recordName(rec: RecordInfo, type: TypeInfo | undefined): string {
  return `${type?.label ?? 'record'} #${rec.id}`;
}

/**
 * A typed ref resolves to a record of that type, or to nothing. A type the
 * workspace does not define is not a record ref at all (a CRM id, a task
 * number from elsewhere) and is never read as "deleted".
 * @param ref
 * @param ref.type
 * @param ref.id
 * @param facts
 */
function resolveRef(ref: { type: string | null; id: number }, facts: Facts): { known: false } | { known: true; rec: RecordInfo | null; type: TypeInfo | undefined } {
  if (ref.type !== null) {
    const type = facts.typeBySlug.get(ref.type);
    if (!type) {
      return { known: false };
    }
    const rec = facts.records.get(ref.id);
    return { known: true, rec: rec && rec.typeId === type.id ? rec : null, type };
  }
  const rec = facts.records.get(ref.id) ?? null;
  return { known: true, rec, type: rec ? facts.typeById.get(rec.typeId) : undefined };
}

/**
 * Why a question is moot: every record it is about settled. Null when any is still open.
 * @param refs
 * @param facts
 */
function settledQuestion(refs: Array<{ type: string | null; id: number }>, facts: Facts): { why: string; link: string } | null {
  const settled: Array<{ rec: RecordInfo; type: TypeInfo | undefined; value: string }> = [];
  for (const ref of refs) {
    const r = resolveRef(ref, facts);
    if (!r.known || !r.rec) {
      continue;
    }
    const value = settledValue(r.rec, r.type);
    if (!value) {
      return null;
    }
    settled.push({ rec: r.rec, type: r.type, value });
  }
  if (settled.length === 0) {
    return null;
  }
  const first = settled[0]!;
  return {
    why: `what it asked about has settled: ${settled.map(s => `${recordName(s.rec, s.type)} is ${s.value}`).join(', ')}`,
    link: facts.href(first.rec),
  };
}

/**
 * Is any record the item names gone?
 * @param refs
 * @param facts
 */
function goneRecord(refs: Array<{ type: string | null; id: number }>, facts: Facts): { why: string; link: null } | null {
  for (const ref of refs) {
    const r = resolveRef(ref, facts);
    if (r.known && !r.rec) {
      return { why: `the ${r.type?.label ?? 'record'} it is about (#${ref.id}) no longer exists`, link: null };
    }
  }
  return null;
}

/**
 * One run's verdict against the facts.
 * @param run
 * @param facts
 * @param now
 */
function runTruth(run: RunForTruth, facts: Facts, now: Date): Truth {
  const refs = runRefs(run);
  const gone = goneRecord(refs, facts);
  if (gone) {
    return { true: false, ...gone };
  }
  if (run.actionId === CANDIDATE_ACTION) {
    const rec = facts.candidateOf.get(run.id);
    const typeSlug = typeof run.input?.objectType === 'string' ? run.input.objectType : null;
    const type = rec ? facts.typeById.get(rec.typeId) : typeSlug ? facts.typeBySlug.get(typeSlug) : undefined;
    if (!rec && type) {
      // Proposing writes the candidate at once; a type that exists with no
      // candidate row means the record was deleted after it was proposed.
      return { true: false, why: `the ${type.label.toLowerCase()} it proposed no longer exists`, link: null };
    }
    if (rec) {
      if (rec.status !== 'candidate') {
        return { true: false, why: `${recordName(rec, type)} was decided on its own record (${rec.status ?? 'no status'})`, link: facts.href(rec) };
      }
      const value = settledValue(rec, type);
      if (value) {
        return { true: false, why: `${recordName(rec, type)} was decided on its own record (${value})`, link: facts.href(rec) };
      }
    }
  }
  if (QUESTION_ACTIONS.has(run.actionId)) {
    const moot = settledQuestion(refs, facts);
    if (moot) {
      return { true: false, ...moot };
    }
  }
  if (run.dedupKey) {
    const newer = facts.newest.get(`${run.actionId}\u0000${run.dedupKey}`);
    if (newer !== undefined && newer > run.id) {
      return { true: false, why: `superseded by proposal #${newer}, filed later for the same thing`, link: inboxHref('proposal', newer) };
    }
  }
  if (run.expiresAt && run.expiresAt <= now) {
    return { true: false, why: `it expired on ${run.expiresAt.toISOString().slice(0, 10)} and left Review then without a decision`, link: null, at: run.expiresAt, expired: true };
  }
  return { true: true };
}

/**
 * One ask's verdict against the facts.
 * @param ask
 * @param facts
 */
function askTruth(ask: AskForTruth, facts: Facts): Truth {
  const refs = askRefs(ask);
  const gone = goneRecord(refs, facts);
  if (gone) {
    return { true: false, ...gone };
  }
  const moot = settledQuestion(refs, facts);
  return moot ? { true: false, ...moot } : { true: true };
}

/**
 * The verdict for each of these items, keyed `run:<id>` / `ask:<id>`. Pure
 * over what it reads; writes nothing.
 * @param orgId - The project the items belong to.
 * @param items - The runs and asks to judge.
 * @param items.runs
 * @param items.asks
 * @param now - The clock.
 * @param link - How a record is linked; the generic record view when omitted.
 */
export async function assessReviewItems(orgId: string, items: { runs: RunForTruth[]; asks: AskForTruth[] }, now: Date = new Date(), link: RecordLinker = recordLinker(NO_RECORD_PAGES)): Promise<Map<string, Truth>> {
  const out = new Map<string, Truth>();
  if (items.runs.length === 0 && items.asks.length === 0) {
    return out;
  }
  const facts = await loadFacts(orgId, items.runs, items.asks, link);
  for (const run of items.runs) {
    out.set(`run:${run.id}`, runTruth(run, facts, now));
  }
  for (const ask of items.asks) {
    out.set(`ask:${ask.id}`, askTruth(ask, facts));
  }
  return out;
}

export type ReviewSweepResult = {
  closed: Array<{ kind: 'run' | 'ask'; id: number; orgId: string; why: string; link: string | null; expired?: boolean }>;
  surfaced: Array<{ kind: 'run' | 'ask'; id: number; orgId: string; since: Date }>;
};

/**
 * One pass over every undecided item in Review — pending action runs and open
 * asks — closing each whose reason is gone and surfacing, once, each still
 * true and older than the bound. Idempotent: a closed item is no longer
 * pending, a surfaced one carries its mark.
 * @param opts - The clock, one org (a test, a manual run), and the bound.
 * @param opts.now
 * @param opts.orgId
 * @param opts.stillWaitingAfterMs
 */
export async function sweepReviewQueue(opts: { now?: Date; orgId?: string; stillWaitingAfterMs?: number } = {}): Promise<ReviewSweepResult> {
  const now = opts.now ?? new Date();
  const bound = opts.stillWaitingAfterMs ?? stillWaitingAfterMs();
  const result: ReviewSweepResult = { closed: [], surfaced: [] };

  const [runs, asks] = await Promise.all([
    db
      .select({
        id: actionRunSchema.id,
        orgId: actionRunSchema.orgId,
        actionId: actionRunSchema.actionId,
        input: actionRunSchema.input,
        dedupKey: actionRunSchema.dedupKey,
        expiresAt: actionRunSchema.expiresAt,
        createdAt: actionRunSchema.createdAt,
        proposal: actionRunSchema.proposal,
      })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.status, 'pending'), opts.orgId ? eq(actionRunSchema.orgId, opts.orgId) : undefined)),
    db
      .select({ id: askSchema.id, orgId: askSchema.orgId, objectRefs: askSchema.objectRefs, createdAt: askSchema.createdAt, notifyAt: askSchema.notifyAt, notified: askSchema.notified })
      .from(askSchema)
      .where(and(eq(askSchema.status, 'open'), opts.orgId ? eq(askSchema.orgId, opts.orgId) : undefined)),
  ]);

  const orgs = new Set([...runs.map(r => r.orgId), ...asks.map(a => a.orgId)]);
  for (const orgId of orgs) {
    const orgRuns = runs.filter(r => r.orgId === orgId);
    const orgAsks = asks.filter(a => a.orgId === orgId);
    // The page the workspace opens each record on, so "closed: plan #134 was
    // approved" links where a person reads the plan. Never fails the sweep.
    const link = await import('@/services/objects/recordHref')
      .then(m => m.recordLinkerForOrg(orgId))
      .catch(() => recordLinker(NO_RECORD_PAGES));
    const truth = await assessReviewItems(orgId, { runs: orgRuns, asks: orgAsks }, now, link);

    for (const run of orgRuns) {
      const t = truth.get(`run:${run.id}`)!;
      if (!t.true) {
        const note = `closed: ${t.why}${t.link ? ` — ${t.link}` : ''}`;
        const at = t.at ?? now;
        const closed = await db
          .update(actionRunSchema)
          .set({
            status: CLOSED_STATUS,
            error: note,
            decidedBy: REVIEW_SWEEPER,
            decidedAt: at,
            // `expired` + `sweptAt`: an item that had already left Review is shown
            // as one line per sweep on the decided tab, never as its own row.
            result: { closed: { why: t.why, link: t.link, by: REVIEW_SWEEPER, at: at.toISOString(), sweptAt: now.toISOString(), ...(t.expired ? { rule: 'expired' } : {}) } },
          })
          // Only if it is still pending: a person deciding it this second wins.
          .where(and(eq(actionRunSchema.id, run.id), eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'pending')))
          .returning({ id: actionRunSchema.id });
        if (closed.length > 0) {
          result.closed.push({ kind: 'run', id: run.id, orgId, why: t.why, link: t.link, expired: t.expired === true });
        }
        continue;
      }
      const proposal = (run.proposal ?? {}) as Record<string, unknown>;
      if (now.getTime() - run.createdAt.getTime() > bound && !proposal.stillWaitingSince) {
        await db
          .update(actionRunSchema)
          .set({ proposal: sql`coalesce(${actionRunSchema.proposal}, '{}'::jsonb) || ${JSON.stringify({ stillWaitingSince: run.createdAt.toISOString(), surfacedAt: now.toISOString() })}::jsonb` })
          .where(and(eq(actionRunSchema.id, run.id), eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'pending')));
        result.surfaced.push({ kind: 'run', id: run.id, orgId, since: run.createdAt });
      }
    }

    for (const ask of orgAsks) {
      const t = truth.get(`ask:${ask.id}`)!;
      if (!t.true) {
        const note = `closed: ${t.why}${t.link ? ` — ${t.link}` : ''}`;
        const closed = await db
          .update(askSchema)
          .set({ status: 'superseded', decisionNote: note, decidedBy: REVIEW_SWEEPER, decidedAt: now, updatedAt: now })
          .where(and(eq(askSchema.id, ask.id), eq(askSchema.orgId, orgId), eq(askSchema.status, 'open')))
          .returning({ id: askSchema.id });
        if (closed.length > 0) {
          result.closed.push({ kind: 'ask', id: ask.id, orgId, why: t.why, link: t.link });
        }
        continue;
      }
      // Surfaced once: an ask already notified on its own (no schedule of
      // its own) gets one more notice, and the notice date is the mark.
      if (now.getTime() - ask.createdAt.getTime() > bound && ask.notifyAt === null && ask.notified) {
        await db
          .update(askSchema)
          .set({ notifyAt: now, notified: false, updatedAt: now })
          .where(and(eq(askSchema.id, ask.id), eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), isNull(askSchema.notifyAt)));
        result.surfaced.push({ kind: 'ask', id: ask.id, orgId, since: ask.createdAt });
      }
    }
  }
  return result;
}
