import type { AskKind, AskObjectRef, AskOption, AskRisk } from '@/models/Schema';
import { and, asc, desc, eq, inArray, isNull, like, lte, or, sql } from 'drizzle-orm';
import { verbosityHints } from '@/features/dashboard/inbox/askText';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import { ASK_KINDS, ASK_RISKS, askSchema } from '@/models/Schema';
import { track } from '@/services/adoption/track';
import { recordAskAlignment } from '@/services/alignment/AlignmentService';
import { proposeLearningFromDecision } from '@/services/feedback/askFeedbackQueue';

export type { AskKind, AskObjectRef, AskOption, AskRisk } from '@/models/Schema';
// The vocabulary lives beside the row (see `models/Schema.ts`); this is its home for readers.
export { ASK_KINDS, ASK_RISKS };

/**
 * AskService — the record of every QUESTION waiting on a HUMAN, and the one
 * place a human's answer is written.
 *
 * An ask is not an action. `action_run` is a proposed connector write that
 * executes when approved; an ask executes nothing. It is a ruling to make, a
 * credential to paste, a PR to merge by hand, a team change to bless, a gate
 * to open. Whoever filed it — an agent, an external worker, a sync script —
 * reads the answer back and acts on it.
 *
 * The shape is a question answered from a phone (the reference is how Claude
 * Code's remote control asks its operator): a short body, named options with
 * at most one recommended, and always a free-text "other" answer. Several
 * asks can share a `groupKey` and be answered as one decision sheet.
 *
 * Asks are filed from three directions, and all land on the same row:
 *   - in-process, by a service, with no `sourceRef`
 *   - by an agent, through the `ask.file` action (`libs/actions/ask-file.ts`)
 *     — proposed, gated by the trust ladder like any other write, and keyed
 *     by `sourceRef` to the action run that filed it
 *   - from outside, over `/api/v1/asks`, keyed by `sourceRef` so re-filing the
 *     same item (a file in an external approval queue, a PR) updates the open
 *     row rather than doubling it. A decided row is never reopened by a re-file.
 *
 * Every read and write here is scoped by orgId.
 */

export const ASK_STATUSES = ['open', 'approved', 'rejected', 'done', 'superseded'] as const;
export type AskStatus = typeof ASK_STATUSES[number];

/** The statuses a decided ask can hold — everything but `open`. */
export const DECIDED_STATUSES = ['approved', 'rejected', 'done', 'superseded'] as const satisfies readonly AskStatus[];
export type DecidedStatus = typeof DECIDED_STATUSES[number];

/** The answers every ask accepts on top of its own options. */
export const FIXED_DECISIONS = ['approve', 'reject', 'done', 'other'] as const;
export type FixedDecision = typeof FIXED_DECISIONS[number];

/** Kinds where an "other" answer means the asker has to read the note and may re-ask. */
export const FOLLOW_UP_KINDS: readonly AskKind[] = ['ruling', 'approval', 'recommendation'];

export type Ask = typeof askSchema.$inferSelect;

/** Errors the API maps 1:1 onto HTTP — the code names the situation, the status the response. */
export class AskError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_FAILED',
    message: string,
    public readonly status: 404 | 409 | 400,
  ) {
    super(message);
    this.name = 'AskError';
  }
}

export function isAskKind(value: unknown): value is AskKind {
  return typeof value === 'string' && (ASK_KINDS as readonly string[]).includes(value);
}

export function isAskRisk(value: unknown): value is AskRisk {
  return typeof value === 'string' && (ASK_RISKS as readonly string[]).includes(value);
}

export function isAskStatus(value: unknown): value is AskStatus {
  return typeof value === 'string' && (ASK_STATUSES as readonly string[]).includes(value);
}

/**
 * A URL-safe id from a label — how a bare string option gets its id.
 * @param label
 */
export function slugifyOption(label: string): string {
  const slug = label.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036F]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'option';
}

/**
 * Normalise what a caller sent as `options` — bare strings, objects, or a mix —
 * into `AskOption[]`. Throws a 400 `AskError` on anything that is not one of
 * those, on a duplicate id, or on more than one `recommended`.
 * @param raw
 */
export function normaliseOptions(raw: unknown): AskOption[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new AskError('VALIDATION_FAILED', 'options must be an array of strings or { id, label, description?, recommended?, confidence? } objects', 400);
  }
  const out: AskOption[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let option: AskOption;
    if (typeof item === 'string') {
      const label = item.trim();
      if (!label) {
        throw new AskError('VALIDATION_FAILED', 'an option label cannot be empty', 400);
      }
      option = { id: slugifyOption(label), label };
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      const label = typeof o.label === 'string' ? o.label.trim() : '';
      if (!label) {
        throw new AskError('VALIDATION_FAILED', 'every option needs a label', 400);
      }
      const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : slugifyOption(label);
      option = { id, label };
      if (typeof o.description === 'string' && o.description.trim()) {
        option.description = o.description.trim();
      }
      if (o.recommended === true) {
        option.recommended = true;
      }
      if (o.confidence !== undefined && o.confidence !== null) {
        if (typeof o.confidence !== 'number' || Number.isNaN(o.confidence) || o.confidence < 0 || o.confidence > 1) {
          throw new AskError('VALIDATION_FAILED', `option "${id}" confidence must be a number between 0 and 1`, 400);
        }
        option.confidence = o.confidence;
      }
    } else {
      throw new AskError('VALIDATION_FAILED', 'options must be strings or { id, label, description?, recommended?, confidence? } objects', 400);
    }
    if (seen.has(option.id)) {
      throw new AskError('VALIDATION_FAILED', `duplicate option id "${option.id}"`, 400);
    }
    seen.add(option.id);
    out.push(option);
  }
  if (out.filter(o => o.recommended).length > 1) {
    throw new AskError('VALIDATION_FAILED', 'at most one option may be recommended', 400);
  }
  return out;
}

/** How many records one ask may be about. A question about more than this is a report, not an ask. */
const MAX_OBJECT_REFS = 20;

/**
 * Normalise what a caller sent as `objectRefs` — `[{ type, id }]` with the id
 * as a string or a number — into `AskObjectRef[]`. Throws a 400 `AskError` on
 * anything else, on a duplicate ref, or on more than {@link MAX_OBJECT_REFS}.
 * @param raw
 */
export function normaliseObjectRefs(raw: unknown): AskObjectRef[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new AskError('VALIDATION_FAILED', 'objectRefs must be an array of { type, id } records', 400);
  }
  if (raw.length > MAX_OBJECT_REFS) {
    throw new AskError('VALIDATION_FAILED', `objectRefs may name at most ${MAX_OBJECT_REFS} records`, 400);
  }
  const out: AskObjectRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AskError('VALIDATION_FAILED', 'each objectRef must be a { type, id } record', 400);
    }
    const o = item as Record<string, unknown>;
    const type = typeof o.type === 'string' ? o.type.trim() : '';
    const id = typeof o.id === 'string' ? o.id.trim() : typeof o.id === 'number' && Number.isFinite(o.id) ? String(o.id) : '';
    if (!type || !id) {
      throw new AskError('VALIDATION_FAILED', 'each objectRef needs a type (an object type slug) and an id', 400);
    }
    const key = `${type}:${id}`;
    if (seen.has(key)) {
      throw new AskError('VALIDATION_FAILED', `duplicate objectRef "${key}"`, 400);
    }
    seen.add(key);
    out.push({ type, id });
  }
  return out;
}

/**
 * Where a person decides one ask — `/w/<workspace>/dashboard/inbox/<id>`,
 * absolute when `NEXT_PUBLIC_APP_URL` is set. The one definition of that
 * link: the API's `url` field and an agent's `file_ask` receipt both read it,
 * so a link pasted into Slack from either opens the same screen.
 * @param projectSlug - The workspace slug (`projectSlugById`).
 * @param askId
 */
export function askUrlFor(projectSlug: string, askId: number): string {
  return workspaceUrl(projectSlug, `/dashboard/inbox/${askId}`, { absolute: true });
}

/**
 * The fields a filer may set, and may change on a re-file. Status is never
 * among them. On a re-file, a field left `undefined` is left as it was and a
 * field set to `null` is cleared — so a caller re-filing only `{ kind, title,
 * sourceRef }` never wipes the body, owner, risk or options it filed before.
 */
export type AskInput = {
  kind: AskKind;
  title: string;
  /** Markdown, short — the question plus a few lines of why. */
  body?: string | null;
  sourceRef?: string | null;
  agentSlug?: string | null;
  teamSlug?: string | null;
  risk?: AskRisk | null;
  /** Already normalised — see `normaliseOptions`. */
  options?: AskOption[];
  /** Already normalised — see `normaliseObjectRefs`. The records the question is about. */
  objectRefs?: AskObjectRef[];
  /** Minutes of a person's attention the decision is estimated to take. */
  decisionCost?: number | null;
  groupKey?: string | null;
  groupTitle?: string | null;
  contextUrl?: string | null;
  contextMd?: string | null;
  dueAt?: Date | null;
  notifyAt?: Date | null;
  projectId?: string | null;
};

/**
 * File an ask. With a `sourceRef` that this org has already filed, the existing
 * row is updated in place (everything a filer may set) and `created` is false
 * — its status, decision and notification state are left exactly as they were,
 * so a re-file can never reopen something a person has already decided.
 * @param opts - Tenant, the ask, and who filed it.
 * @param opts.orgId
 * @param opts.ask
 * @param opts.createdBy
 */
export async function upsertAsk(opts: { orgId: string; ask: AskInput; createdBy?: string | null }): Promise<{ ask: Ask; created: boolean }> {
  const { orgId, ask } = opts;
  // A hint, not a refusal: the screen clamps whatever arrives, but a filer
  // reading its own log learns to write the question short and put the long
  // form in contextMd.
  const hints = verbosityHints(ask);
  if (hints.length > 0) {
    console.warn(`[AskService] verbose ask "${ask.title.slice(0, 60)}"${ask.sourceRef ? ` (${ask.sourceRef})` : ''}: ${hints.join('; ')}`);
  }
  // Only the keys the caller actually sent. `undefined` means "not mentioned",
  // and an unmentioned field must survive a re-file.
  const mutable = Object.fromEntries(
    Object.entries({
      kind: ask.kind,
      title: ask.title,
      body: ask.body,
      agentSlug: ask.agentSlug,
      teamSlug: ask.teamSlug,
      risk: ask.risk,
      options: ask.options,
      objectRefs: ask.objectRefs,
      decisionCost: ask.decisionCost,
      groupKey: ask.groupKey,
      groupTitle: ask.groupTitle,
      contextUrl: ask.contextUrl,
      contextMd: ask.contextMd,
      dueAt: ask.dueAt,
      notifyAt: ask.notifyAt,
      projectId: ask.projectId,
    }).filter(([, v]) => v !== undefined),
  ) as Partial<Pick<Ask, 'kind' | 'title' | 'body' | 'agentSlug' | 'teamSlug' | 'risk' | 'options' | 'objectRefs' | 'decisionCost' | 'groupKey' | 'groupTitle' | 'contextUrl' | 'contextMd' | 'dueAt' | 'notifyAt' | 'projectId'>> & Pick<Ask, 'kind' | 'title'>;

  const sourceRef = ask.sourceRef?.trim() || null;
  if (sourceRef) {
    const [existing] = await db
      .select({ id: askSchema.id })
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), eq(askSchema.sourceRef, sourceRef)))
      .limit(1);
    if (existing) {
      const [row] = await db
        .update(askSchema)
        .set({ ...mutable, updatedAt: new Date() })
        .where(and(eq(askSchema.orgId, orgId), eq(askSchema.id, existing.id)))
        .returning();
      return { ask: row!, created: false };
    }
  }

  // ONE QUESTION, ONE ROW (review sweep, 2026-09-26: 89 open asks, most of
  // them the same question filed again — "Approve build: Send e2e runner" four
  // times, "CRITICAL (check 10)" escalations of an unanswered one). An open ask
  // of the same kind and title in this workspace IS this ask: it is refreshed, not
  // doubled, and the person answers it once.
  const [same] = await db
    .select({ id: askSchema.id })
    .from(askSchema)
    .where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), eq(askSchema.kind, ask.kind), sql`lower(trim(${askSchema.title})) = lower(trim(${ask.title}))`))
    .limit(1);
  if (same) {
    const [row] = await db
      .update(askSchema)
      .set({ ...mutable, updatedAt: new Date() })
      .where(and(eq(askSchema.orgId, orgId), eq(askSchema.id, same.id)))
      .returning();
    return { ask: row!, created: false };
  }

  const [row] = await db
    .insert(askSchema)
    .values({ ...mutable, orgId, sourceRef, createdBy: opts.createdBy ?? null })
    .returning();
  return { ask: row!, created: true };
}

/**
 * One ask, or `null` when this org does not own it. Scoping by org is what
 * makes a wrong id a 404 rather than another tenant's row.
 * @param orgId
 * @param id
 */
export async function getAsk(orgId: string, id: number): Promise<Ask | null> {
  const [row] = await db.select().from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.id, id))).limit(1);
  return row ?? null;
}

/**
 * Every ask in one decision sheet, oldest first — open and decided alike, so
 * the sheet can show its receipt. Empty when the org has no such group.
 * @param orgId
 * @param groupKey
 */
export async function listAskGroup(orgId: string, groupKey: string): Promise<Ask[]> {
  return db.select().from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.groupKey, groupKey))).orderBy(asc(askSchema.id));
}

/**
 * How many asks are still open in each of several groups — the open-items
 * count a board shows per room, in one query. Groups with nothing open are
 * absent from the map.
 * @param orgId
 * @param groupKeys
 */
export async function countOpenAsksByGroup(orgId: string, groupKeys: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (groupKeys.length === 0) {
    return out;
  }
  const rows = await db
    .select({ groupKey: askSchema.groupKey, n: sql<number>`count(*)::int` })
    .from(askSchema)
    .where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), inArray(askSchema.groupKey, groupKeys)))
    .groupBy(askSchema.groupKey);
  for (const r of rows) {
    if (r.groupKey) {
      out.set(r.groupKey, Number(r.n));
    }
  }
  return out;
}

/**
 * `open` | `decided` | `all`, or one exact status.
 * `decided` is every status a person has already answered with.
 */
export type AskStatusFilter = 'open' | 'decided' | 'all' | AskStatus;

export function isAskStatusFilter(value: unknown): value is AskStatusFilter {
  return value === 'open' || value === 'decided' || value === 'all' || isAskStatus(value);
}

export type ListAsksOptions = {
  status?: AskStatusFilter;
  /** Prefix match on `sourceRef` — `workforce:` narrows to one filer. */
  source?: string;
  agentSlug?: string;
  kind?: AskKind;
  groupKey?: string;
  limit?: number;
  offset?: number;
};

/**
 * Escape `%` and `_` so a prefix is matched literally by LIKE.
 * @param prefix
 */
function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
}

/**
 * A page of asks, newest first, with the total the filters matched. The
 * default is the open queue — what still needs a person.
 * @param orgId
 * @param opts
 */
export async function listAsks(orgId: string, opts: ListAsksOptions = {}): Promise<{ items: Ask[]; total: number; limit: number; offset: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const status = opts.status ?? 'open';
  const filters = [eq(askSchema.orgId, orgId)];
  if (status === 'open') {
    filters.push(eq(askSchema.status, 'open'));
  } else if (status === 'decided') {
    filters.push(inArray(askSchema.status, [...DECIDED_STATUSES]));
  } else if (status !== 'all') {
    filters.push(eq(askSchema.status, status));
  }
  if (opts.source) {
    filters.push(like(askSchema.sourceRef, likePrefix(opts.source)));
  }
  if (opts.agentSlug) {
    filters.push(eq(askSchema.agentSlug, opts.agentSlug));
  }
  if (opts.kind) {
    filters.push(eq(askSchema.kind, opts.kind));
  }
  if (opts.groupKey) {
    filters.push(eq(askSchema.groupKey, opts.groupKey));
  }
  const where = and(...filters);

  const [items, [counted]] = await Promise.all([
    db.select().from(askSchema).where(where).orderBy(desc(askSchema.id)).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(askSchema).where(where),
  ]);
  return { items, total: counted?.total ?? 0, limit, offset };
}

/**
 * How many asks are open for this org — the number the sidebar shows.
 * @param orgId
 */
export async function countOpenAsks(orgId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(askSchema)
    .where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open')));
  return row?.total ?? 0;
}

/** What one decision resolves to. */
type Resolved = { status: DecidedStatus; followUp: boolean };

/**
 * Resolve a decision against the ask. `approve` / `reject` / `done` / `other`
 * are always accepted; anything else must be one of the ask's option ids. An
 * option chosen, or `other`, is recorded as `done` with the decision naming
 * it. `other` needs a note — the note IS the answer — and on a ruling,
 * approval or recommendation flags `followUp`, because the asker has to read
 * it and may need to ask again.
 * @param ask
 * @param decision
 * @param note
 */
function resolveDecision(ask: Ask, decision: string, note: string | null): Resolved {
  switch (decision) {
    case 'approve':
      return { status: 'approved', followUp: false };
    case 'reject':
      return { status: 'rejected', followUp: false };
    case 'done':
      return { status: 'done', followUp: false };
    case 'other':
      if (!note) {
        throw new AskError('VALIDATION_FAILED', 'an "other" answer needs a note — the note is the answer', 400);
      }
      return { status: 'done', followUp: FOLLOW_UP_KINDS.includes(ask.kind as AskKind) };
    default:
      if (!ask.options.some(o => o.id === decision)) {
        const ids = ask.options.map(o => o.id);
        throw new AskError(
          'VALIDATION_FAILED',
          ids.length > 0
            ? `decision must be approve, reject, done, other, or one of: ${ids.join(', ')}`
            : 'decision must be approve, reject, done, or other',
          400,
        );
      }
      return { status: 'done', followUp: false };
  }
}

/**
 * Record a person's answer. Only an `open` ask can be decided — a second
 * decision is a 409, never a silent overwrite, because the first answer may
 * already have been acted on by whoever filed the ask.
 * @param opts
 * @param opts.orgId
 * @param opts.id
 * @param opts.decision - `approve` | `reject` | `done` | `other` | an option id.
 * @param opts.note - Required with `other`; optional otherwise.
 * @param opts.decidedBy - The actor id from the API caller.
 */
export async function decideAsk(opts: { orgId: string; id: number; decision: string; note?: string | null; decidedBy: string }): Promise<Ask> {
  const ask = await getAsk(opts.orgId, opts.id);
  if (!ask) {
    throw new AskError('NOT_FOUND', `No ask ${opts.id}`, 404);
  }
  if (ask.status !== 'open') {
    throw new AskError('CONFLICT', `Ask ${opts.id} was already decided (${ask.status})`, 409);
  }
  const decision = opts.decision.trim();
  const note = opts.note?.trim() || null;
  const { status, followUp } = resolveDecision(ask, decision, note);
  const now = new Date();
  const [row] = await db
    .update(askSchema)
    .set({ status, decision, decisionNote: note, followUp, decidedBy: opts.decidedBy, decidedAt: now, updatedAt: now })
    .where(and(eq(askSchema.orgId, opts.orgId), eq(askSchema.id, opts.id), eq(askSchema.status, 'open')))
    .returning();
  if (!row) {
    // Lost the race to another decider between the read and the write.
    throw new AskError('CONFLICT', `Ask ${opts.id} was already decided`, 409);
  }
  await Promise.all([
    // The kind, the asker and the records it was about ride the event, so a
    // subscriber can act on "this agent's recommendations about that request"
    // without reading the row back.
    track(
      { orgId: opts.orgId, userId: opts.decidedBy },
      'ask.decided',
      { agentSlug: ask.agentSlug, resource: ['ask', ask.id], meta: { kind: ask.kind as AskKind, status, objectRefs: ask.objectRefs ?? [] } },
    ),
    // A correction with a reason is a rule waiting to be written.
    proposeLearningFromDecision({ ask, decision, note, decidedBy: opts.decidedBy }),
    // And every answer is alignment evidence: did the person choose the
    // option the team recommended? Read back on the sheet and by the ladder.
    recordAskAlignment({ ask, decision, note, decidedBy: opts.decidedBy }),
  ]);
  announceDecided(row);
  return row;
}

/**
 * Tell the rest of the system an ask was decided — the `ask.decided` event an
 * automation can subscribe to (`when.event`, docs/entities/automation.md).
 * Fire-and-forget, the way `ArtifactService` announces a save: the person's
 * decision is already written and returned, a subscriber that fails is logged
 * and never surfaces to the decider, and the dynamic import keeps this module
 * out of the event bus's dependency graph.
 * @param row - The decided ask, as written.
 */
function announceDecided(row: Ask): void {
  void (async () => {
    try {
      const { ASK_DECIDED, emitEvent } = await import('@/services/EventService');
      await emitEvent({
        orgId: row.orgId,
        type: ASK_DECIDED,
        payload: {
          askId: row.id,
          kind: row.kind,
          status: row.status,
          decision: row.decision ?? '',
          followUp: row.followUp,
          agentSlug: row.agentSlug ?? null,
          teamSlug: row.teamSlug ?? null,
          groupKey: row.groupKey ?? null,
          sourceRef: row.sourceRef ?? null,
          objectRefs: row.objectRefs ?? [],
          decidedBy: row.decidedBy ?? '',
          decidedAt: (row.decidedAt ?? new Date()).toISOString(),
        },
        dedupeKey: `ask.decided:${row.id}`,
        invokedBy: row.decidedBy ?? `ask:${row.id}`,
      });
    } catch (err) {
      const { logger } = await import('@/libs/Logger');
      logger.warn('ask.decided announcement failed', { askId: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  })();
}

/**
 * Close an open ask without a human answer — the thing it asked about went
 * away (the PR merged on its own, the file was withdrawn). Idempotent on an
 * already-decided row: it is left as it is and returned.
 * @param orgId
 * @param id
 * @param note
 */
export async function supersedeAsk(orgId: string, id: number, note?: string | null): Promise<Ask> {
  const ask = await getAsk(orgId, id);
  if (!ask) {
    throw new AskError('NOT_FOUND', `No ask ${id}`, 404);
  }
  if (ask.status !== 'open') {
    return ask;
  }
  const now = new Date();
  const [row] = await db
    .update(askSchema)
    .set({ status: 'superseded', decisionNote: note?.trim() || null, decidedAt: now, updatedAt: now })
    .where(and(eq(askSchema.orgId, orgId), eq(askSchema.id, id)))
    .returning();
  return row!;
}

/**
 * Put a superseded ask back in front of people — the undo of a withdrawal
 * (`ask.withdraw`). Only a `superseded` row reopens: a person's own answer is
 * never unwritten by this, so an ask someone approved or rejected is left as
 * it is and returned. Idempotent on an already-open row.
 * @param orgId
 * @param id
 */
export async function reopenAsk(orgId: string, id: number): Promise<Ask> {
  const ask = await getAsk(orgId, id);
  if (!ask) {
    throw new AskError('NOT_FOUND', `No ask ${id}`, 404);
  }
  if (ask.status !== 'superseded') {
    return ask;
  }
  const [row] = await db
    .update(askSchema)
    .set({ status: 'open', decisionNote: null, decidedAt: null, updatedAt: new Date() })
    .where(and(eq(askSchema.orgId, orgId), eq(askSchema.id, id), eq(askSchema.status, 'superseded')))
    .returning();
  return row ?? ask;
}

/**
 * Open asks nobody has been told about yet, whose `notifyAt` (if any) has
 * passed — what a mailer or chat hook should ping about. Oldest first. Pass
 * `orgId` for one tenant, or omit it for a deployment-wide sweep. The caller
 * marks them with `markNotified` once the ping is out; nothing here sends.
 * @param opts
 * @param opts.orgId
 * @param opts.now
 * @param opts.limit
 */
export async function pendingNotifications(opts: { orgId?: string; now?: Date; limit?: number } = {}): Promise<Ask[]> {
  const now = opts.now ?? new Date();
  return db
    .select()
    .from(askSchema)
    .where(and(
      opts.orgId ? eq(askSchema.orgId, opts.orgId) : undefined,
      eq(askSchema.status, 'open'),
      eq(askSchema.notified, false),
      or(isNull(askSchema.notifyAt), lte(askSchema.notifyAt, now)),
    ))
    .orderBy(asc(askSchema.id))
    .limit(opts.limit ?? 100);
}

/**
 * Record that a notification went out for these asks.
 * @param orgId
 * @param ids
 */
export async function markNotified(orgId: string, ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await db
    .update(askSchema)
    .set({ notified: true, updatedAt: new Date() })
    .where(and(eq(askSchema.orgId, orgId), inArray(askSchema.id, ids)));
}
