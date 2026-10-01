/**
 * IS THIS NEW RECORD ONE WE ALREADY HAVE? — read by a model, never matched
 * (backlog 044). On 2026-09-30 the same request was filed twice from chat a
 * minute apart (#265, then #268), and the second one got its own Build card:
 * nothing at intake asked whether it was already on file. A person closed it
 * by hand.
 *
 * A type opts in on its schema, so core names no type:
 *
 *   x-duplicate-check:
 *     field: duplicateOf     # the integer field that links a duplicate to the record it repeats
 *     within: [product]      # candidates share these fields' values with the new record
 *     compare: [outcome, story, body]  # what is read beside the title
 *     bar: 0.8               # above it the link is written, with Undo; below it, nothing is
 *     settledDays: 14        # a settled record (`x-settled`) is a candidate this long after it last changed
 *
 * The shortlist is a filter, not the judge: trigram overlap on the title and
 * the compared fields puts the textually close records first, and the rest
 * of the slots go to the newest, because an ask worded nothing like the new
 * one is exactly the duplicate overlap cannot see (the shape
 * `services/feedback/duplicateDetection.ts` uses). One classifier call then
 * returns typed `{duplicateOf, confidence, reason}`, and code routes on it.
 *
 * NEVER BLOCKS FILING. The record already exists when this runs. Above the
 * bar the link goes through `objects.update_meta` on the trust ladder, done
 * for you with Undo on the record's history and on its status line; below
 * it, nothing is written and nothing is shown. A read that fails, an id the
 * model invented, or a link a person has undone before all end in "not a
 * duplicate": a duplicate left open is one tap to close, a request closed by
 * mistake is an ask nobody works.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RecordStatus } from '@/libs/factory/liveStatus';
import { z } from 'zod';
import { DEFAULT_AUTO_ACCEPT_CONFIDENCE } from '@/libs/actions/autoAccept';
import { similarity } from '@/services/MemoryService';

type Meta = Record<string, unknown>;
type Model = Pick<BaseChatModel, 'bindTools'>;

/** The type's `x-duplicate-check`, read. */
export type DuplicateCheckSpec = {
  field: string;
  within: string[];
  compare: string[];
  bar: number;
  settledDays: number;
};

/** How many existing records the judge reads at once. */
export const DUPLICATE_SHORTLIST = 10;
/** How many of the type's newest records the shortlist is drawn from. */
const CANDIDATE_POOL = 200;
/** Overlap that earns a place at the front of the shortlist. Ordering only; the model decides. */
const OVERLAP_FIRST = 0.15;
const DEFAULT_SETTLED_DAYS = 14;
/** Core's own lifecycle: a dismissed or archived record is never what a new one repeats. */
const DISMISSED_STATUSES = new Set(['rejected', 'archived']);

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []);

/**
 * The type schema's `x-duplicate-check` descriptor, or null when it declares none (or a malformed one).
 * @param schema - The object type's JSON schema.
 */
export function duplicateCheckOf(schema: unknown): DuplicateCheckSpec | null {
  const raw = (schema as Meta | null | undefined)?.['x-duplicate-check'] as Meta | undefined;
  if (!raw || typeof raw !== 'object' || typeof raw.field !== 'string' || raw.field.length === 0) {
    return null;
  }
  const bar = typeof raw.bar === 'number' && raw.bar > 0 && raw.bar <= 1 ? raw.bar : DEFAULT_AUTO_ACCEPT_CONFIDENCE;
  const settledDays = typeof raw.settledDays === 'number' && raw.settledDays >= 0 ? raw.settledDays : DEFAULT_SETTLED_DAYS;
  return { field: raw.field, within: strings(raw.within), compare: strings(raw.compare), bar, settledDays };
}

/** A record as the check reads it. */
export type DuplicateCandidate = {
  id: number;
  title: string;
  /** The compared fields, as one text. */
  text: string;
  /** The value that settled it (`x-settled`), or null while it is open. */
  settled: string | null;
};

/**
 * The compared fields of a record, as one text a person could read.
 * @param meta - The record's fields.
 * @param compare - Which fields.
 */
export function comparedText(meta: Meta, compare: readonly string[]): string {
  return compare.flatMap((key) => {
    const v = meta[key];
    if (typeof v === 'string' && v.trim()) {
      return [v.trim()];
    }
    if (Array.isArray(v)) {
      const items = v.map(x => (typeof x === 'string' ? x : typeof x === 'object' && x && typeof (x as Meta).statement === 'string' ? String((x as Meta).statement) : '')).filter(Boolean);
      return items.length > 0 ? [items.join('; ')] : [];
    }
    return [];
  }).join(' — ').slice(0, 1_500);
}

/**
 * Which existing records the judge reads: the textually close first, then
 * the newest, open before settled at equal footing. Exported for its own
 * test — this is where a real duplicate gets lost.
 * @param record - The new record.
 * @param record.title - Its title.
 * @param record.text - Its compared fields.
 * @param candidates - Existing records, newest first.
 * @param limit - At most this many.
 * @param first - Records the new one names, read before anything else.
 */
export function shortlistDuplicates(record: { title: string; text: string }, candidates: readonly DuplicateCandidate[], limit = DUPLICATE_SHORTLIST, first: readonly number[] = []): DuplicateCandidate[] {
  const probe = `${record.title} ${record.text}`;
  const close = candidates
    .map(c => ({ c, score: Math.max(similarity(record.title, c.title), similarity(probe, `${c.title} ${c.text}`)) }))
    .filter(x => x.score >= OVERLAP_FIRST)
    .sort((a, b) => b.score - a.score)
    .map(x => x.c);
  const picked = new Map<number, DuplicateCandidate>();
  for (const c of [...candidates.filter(c => first.includes(c.id)), ...close, ...candidates.filter(c => c.settled === null), ...candidates]) {
    if (picked.size >= limit) {
      break;
    }
    picked.set(c.id, c);
  }
  return [...picked.values()];
}

/**
 * How the new record stands to the one it names. Three of them mean its work
 * is that record's, and it is linked as that record's duplicate:
 *
 *   same_ask    the same outcome in other words — delivering one delivers the other;
 *   same_fault  the same fault from the other side — an outage reported as its
 *               symptom beside the fix for its cause (FE-318 "every signed-in
 *               call returns 500" beside FE-314 "fix the arm64 image build",
 *               2026-10-01): fixing one fixes the other;
 *   work_on     work on that record itself — its build again, another attempt,
 *               its contract or its plan (FE-322 "write a corrected contract",
 *               filed for FE-314's own failed build).
 *
 * `different` is everything else, and nothing is linked.
 */
export const DUPLICATE_RELATIONS = ['same_ask', 'same_fault', 'work_on', 'different'] as const;
export type DuplicateRelation = typeof DUPLICATE_RELATIONS[number];

export const DuplicateJudgementSchema = z.object({
  duplicateOf: z.number().int().nullable().describe('The number (#id) of the listed existing record whose work this new one is — the same ask, the same fault, or work on that record itself. null when none is. Only a number from the list.'),
  relation: z.enum(DUPLICATE_RELATIONS).default('same_ask').describe('How the new record stands to that one: same_ask — the same outcome in other words; same_fault — the same fault from the other side (an outage reported as its symptom, beside the fix for its cause), so fixing one fixes the other; work_on — it asks for work on that record itself: its build again, another attempt, its contract or its plan; different — none of these.'),
  confidence: z.number().min(0).max(1).describe('How sure you are, from 0 to 1, that the new record and that one are the same ask. 0.9+ means the same outcome in other words; 0.5 means they overlap but one asks for more or for something else. With duplicateOf null, how sure you are that none is the same.'),
  reason: z.string().max(240).describe('One line a person reads: what makes them the same ask, or why none is.'),
});
export type DuplicateJudgement = z.infer<typeof DuplicateJudgementSchema>;

const SYSTEM = [
  'You decide whether a record just filed in a work app is work that already belongs to one on file.',
  'It does when doing that one would satisfy it: the same outcome for the same people, however it is worded (same_ask); the same fault seen from the other side, such as an outage reported by its symptom beside a record that fixes its cause, so fixing one fixes the other (same_fault); or work on that record itself, such as building it again, another attempt, its contract or its plan (work_on). A later report of the same fault is the same.',
  'A record that asks for more, for less, for a different surface or for a different situation is NOT the same, even when it shares words: answer different.',
  'Answer only through the tool.',
].join(' ');

/**
 * The new record and its shortlist, as one read.
 * @param input - What the judge reads.
 * @param input.label - The type's label ("Request").
 * @param input.record - The new record.
 * @param input.record.id
 * @param input.record.title
 * @param input.record.text
 * @param input.shortlist - The existing records.
 */
export function judgeText(input: { label: string; record: { id: number; title: string; text: string }; shortlist: readonly DuplicateCandidate[] }): string {
  return [
    `NEW ${input.label} #${input.record.id}: ${input.record.title}${input.record.text ? `\n${input.record.text}` : ''}`,
    'ALREADY ON FILE:',
    ...input.shortlist.map(c => `#${c.id} (${c.settled ? `closed: ${c.settled}` : 'open'}): ${c.title}${c.text ? ` — ${c.text.slice(0, 600)}` : ''}`),
  ].join('\n').slice(0, 16_000);
}

/**
 * Is the new record one of these? Typed, or null when the read failed.
 * @param input - What the judge reads.
 * @param input.orgId - The workspace (its classifier key, its spend).
 * @param input.label - The type's label.
 * @param input.record - The new record.
 * @param input.record.id
 * @param input.record.title
 * @param input.record.text
 * @param input.shortlist - The existing records.
 * @param model - Injected in tests.
 */
export async function judgeDuplicate(input: { orgId: string; label: string; record: { id: number; title: string; text: string }; shortlist: readonly DuplicateCandidate[] }, model?: Model): Promise<DuplicateJudgement | null> {
  try {
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const m = model ?? await (async () => {
      const { buildChatModelForOrg } = await import('@/libs/llm');
      return buildChatModelForOrg('classifier', input.orgId, { temperature: 0, streaming: false, maxTokens: 300 }) as Promise<Model>;
    })();
    const report = tool(async () => 'recorded', { name: 'report_duplicate', description: 'Report whether the new record repeats one already on file.', schema: DuplicateJudgementSchema as never });
    const bound = m.bindTools!([report], { tool_choice: 'report_duplicate' } as never);
    const res = await bound.invoke([new SystemMessage(SYSTEM), new HumanMessage(judgeText(input))]) as { tool_calls?: Array<{ name: string; args: unknown }> };
    if (!model) {
      const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
      const { FEATURES } = await import('@/libs/Langfuse/features');
      await chargeModelCall({ orgId: input.orgId, feature: FEATURES.RECORD_DUPLICATE, role: 'classifier', response: res });
    }
    const call = (res.tool_calls ?? []).find(c => c.name === 'report_duplicate');
    const parsed = call ? DuplicateJudgementSchema.safeParse(call.args) : null;
    return parsed?.success ? parsed.data : null;
  } catch (err) {
    console.warn('duplicate check: the read failed', { orgId: input.orgId, recordId: input.record.id, message: (err as Error).message });
    return null;
  }
}

/** What the check did, for the caller's log and its result. */
export type DuplicateFinding = {
  /** Whether a judgement was made (false: the type opts out, nothing to compare, or the read failed). */
  checked: boolean;
  /** Why it was not, or what it found, in a few words. */
  did: string;
  duplicateOf: number | null;
  /** How it stands to that record, as the judge read it. */
  relation: DuplicateRelation | null;
  confidence: number | null;
  reason: string | null;
  /** The link was written (done for you) — the record is now closed as a duplicate. */
  linked: boolean;
  /** The run that wrote it, for Undo; or the card, when the trust ladder asked a person. */
  runId: number | null;
  /** One line a person reads, when there is one to say. */
  line: string | null;
};

const none = (did: string, extra: Partial<DuplicateFinding> = {}): DuplicateFinding => ({ checked: false, did, duplicateOf: null, relation: null, confidence: null, reason: null, linked: false, runId: null, line: null, ...extra });

type Row = { id: number; typeId: number; title: string; status: string | null; metadata: Meta; updatedAt: Date };
type TypeRow = { id: number; slug: string; label: string; schema: unknown };

async function readRecordAndType(orgId: string, id: number): Promise<{ row: Row; type: TypeRow } | null> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const [hit] = await db
    .select({ id: businessObjectSchema.id, typeId: businessObjectSchema.typeId, title: businessObjectSchema.title, status: businessObjectSchema.status, metadata: businessObjectSchema.metadata, updatedAt: businessObjectSchema.updatedAt, typeSlug: businessObjectTypeSchema.slug, typeLabel: businessObjectTypeSchema.label, typeSchema: businessObjectTypeSchema.schema })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)))
    .limit(1);
  if (!hit) {
    return null;
  }
  return {
    row: { id: hit.id, typeId: hit.typeId, title: hit.title, status: hit.status, metadata: (hit.metadata ?? {}) as Meta, updatedAt: hit.updatedAt },
    type: { id: hit.typeId, slug: hit.typeSlug, label: hit.typeLabel, schema: hit.typeSchema },
  };
}

/**
 * The type's records filed before this one that could be what it repeats:
 * the same values in `within`, not themselves marked duplicates, not
 * dismissed, and open or settled within `settledDays`. Newest first.
 * @param orgId - Tenant.
 * @param row - The new record.
 * @param spec - The type's check.
 * @param schema - The type's schema (for `x-settled`).
 * @param now - The clock.
 */
async function candidatesFor(orgId: string, row: Row, spec: DuplicateCheckSpec, schema: unknown, now: Date): Promise<DuplicateCandidate[]> {
  const { and, desc, eq, lt } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const { settledDescriptor } = await import('@/services/proposals/ReviewTruthService');
  const rows = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, status: businessObjectSchema.status, metadata: businessObjectSchema.metadata, updatedAt: businessObjectSchema.updatedAt })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, row.typeId), lt(businessObjectSchema.id, row.id)))
    .orderBy(desc(businessObjectSchema.id))
    .limit(CANDIDATE_POOL);
  const settled = settledDescriptor(schema);
  const since = now.getTime() - spec.settledDays * 24 * 60 * 60_000;
  const same = (m: Meta) => spec.within.every(f => String(m[f] ?? '') === String(row.metadata[f] ?? ''));
  return rows.flatMap((r) => {
    const m = (r.metadata ?? {}) as Meta;
    if (DISMISSED_STATUSES.has(String(r.status ?? '')) || Number(m[spec.field] ?? 0) > 0 || !same(m)) {
      return [];
    }
    const value = settled && settled.in.includes(String(m[settled.field] ?? '')) ? String(m[settled.field]) : null;
    if (value !== null && r.updatedAt.getTime() < since) {
      return [];
    }
    return [{ id: r.id, title: r.title, text: comparedText(m, spec.compare), settled: value }];
  });
}

/** How many records a new one names are followed. */
const NAMED_LIMIT = 10;
/** A code a person reads (`FE-314`, `TK-317`) or a record's page (`/objects/316`) — an identifier, not a meaning. */
const CODE = /\b[A-Z]{2,5}-\d{1,9}\b/g;
const RECORD_PAGE = /\/objects\/(\d{1,9})\b/g;

/**
 * The records of the new one's type that it NAMES: by code or by page in its
 * own fields, directly, or through a record it names that links to one (a
 * task naming its request). Candidates whatever their `within` fields say —
 * a record that names another is the likeliest to be its work. Filtered like
 * {@link candidatesFor}: not dismissed, not a duplicate itself, not long settled.
 * @param orgId - Tenant.
 * @param row - The new record.
 * @param spec - The type's check.
 * @param schema - The type's schema (for `x-settled`).
 * @param now - The clock.
 */
async function namedCandidates(orgId: string, row: Row, spec: DuplicateCheckSpec, schema: unknown, now: Date): Promise<DuplicateCandidate[]> {
  const text = JSON.stringify(row.metadata ?? {});
  const ids = new Set<number>();
  const { resolveCode } = await import('@/services/codes');
  for (const code of new Set([...text.matchAll(CODE)].map(m => m[0]))) {
    if (ids.size >= NAMED_LIMIT) {
      break;
    }
    const hit = await resolveCode(orgId, code).catch(() => null);
    if (hit?.kind === 'record') {
      ids.add(hit.id);
    }
  }
  for (const m of text.matchAll(RECORD_PAGE)) {
    ids.add(Number(m[1]));
  }
  ids.delete(row.id);
  if (ids.size === 0) {
    return [];
  }
  const { and, eq, inArray } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const { relationsOf } = await import('@/libs/workspace/related');
  const read = (wanted: number[]) => db
    .select({ id: businessObjectSchema.id, typeId: businessObjectSchema.typeId, title: businessObjectSchema.title, status: businessObjectSchema.status, metadata: businessObjectSchema.metadata, updatedAt: businessObjectSchema.updatedAt, typeSchema: businessObjectTypeSchema.schema })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, wanted)));
  const direct = await read([...ids].slice(0, NAMED_LIMIT));
  // A named record of another type points on to the record it serves, by its
  // own declared links (`x-related`, `from: links`).
  const onward = direct.filter(r => r.typeId !== row.typeId).flatMap(r => relationsOf(r.typeSchema as Record<string, unknown>)
    .filter(rel => rel.from === 'links' && rel.field)
    .map(rel => Number((r.metadata as Meta | null)?.[rel.field!]))
    .filter(n => Number.isInteger(n) && n > 0 && n !== row.id));
  const linked = onward.length > 0 ? await read([...new Set(onward)].slice(0, NAMED_LIMIT)) : [];
  const { settledDescriptor } = await import('@/services/proposals/ReviewTruthService');
  const settled = settledDescriptor(schema);
  const since = now.getTime() - spec.settledDays * 24 * 60 * 60_000;
  const seen = new Set<number>();
  return [...direct, ...linked].flatMap((r) => {
    const m = (r.metadata ?? {}) as Meta;
    if (r.typeId !== row.typeId || r.id >= row.id || seen.has(r.id) || DISMISSED_STATUSES.has(String(r.status ?? '')) || Number(m[spec.field] ?? 0) > 0) {
      return [];
    }
    seen.add(r.id);
    const value = settled && settled.in.includes(String(m[settled.field] ?? '')) ? String(m[settled.field]) : null;
    if (value !== null && r.updatedAt.getTime() < since) {
      return [];
    }
    return [{ id: r.id, title: r.title, text: comparedText(m, spec.compare), settled: value }];
  });
}

/**
 * The dedup key `objects.update_meta` gives a write of exactly this field on this record.
 * @param slug
 * @param id
 * @param field
 */
function linkKey(slug: string, id: number, field: string): string {
  return `objects.update_meta:${slug.trim().toLowerCase()}:${id}:${field}`;
}

/**
 * Has a person undone this link on this record before? Then it is not a
 * duplicate, and it is not judged again.
 * @param orgId - Tenant.
 * @param key - The link's dedup key.
 */
async function linkWasUndone(orgId: string, key: string): Promise<boolean> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  const [hit] = await db.select({ id: actionRunSchema.id }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.dedupKey, key), eq(actionRunSchema.status, 'undone'))).limit(1);
  return Boolean(hit);
}

/**
 * THE CHECK, when a record has just been filed. Never throws, never blocks:
 * the record stands whatever this finds.
 * @param orgId - Tenant.
 * @param payload - The `object.created` payload (the record's id, where it was filed).
 * @param payload.objectId
 * @param payload.conversationId
 * @param payload.byPerson
 * @param opts - Options.
 * @param opts.model - The judge's model, injected in tests.
 * @param opts.now - The clock.
 */
export async function checkNewRecordForDuplicate(orgId: string, payload: { objectId?: unknown; conversationId?: unknown; byPerson?: unknown }, opts: { model?: Model; now?: Date } = {}): Promise<DuplicateFinding> {
  try {
    const id = Number(payload.objectId);
    if (!Number.isInteger(id) || id <= 0) {
      return none('no record named');
    }
    const read = await readRecordAndType(orgId, id);
    if (!read) {
      return none('no such record');
    }
    const spec = duplicateCheckOf(read.type.schema);
    if (!spec) {
      return none('the type asks for no duplicate check');
    }
    if (Number(read.row.metadata[spec.field] ?? 0) > 0) {
      return none('already linked');
    }
    const key = linkKey(read.type.slug, id, spec.field);
    if (await linkWasUndone(orgId, key)) {
      return none('a person undid this link before');
    }
    const now = opts.now ?? new Date();
    // What it names comes first, whatever its fields say: FE-322 named
    // FE-314's own tasks and sat under another product, so `within` alone
    // never showed the judge the record it was work on.
    const named = await namedCandidates(orgId, read.row, spec, read.type.schema, now).catch(() => []);
    const candidates = [...named, ...(await candidatesFor(orgId, read.row, spec, read.type.schema, now)).filter(c => !named.some(n => n.id === c.id))];
    if (candidates.length === 0) {
      return none('nothing on file to compare');
    }
    const record = { id, title: read.row.title, text: comparedText(read.row.metadata, spec.compare) };
    const shortlist = shortlistDuplicates(record, candidates, DUPLICATE_SHORTLIST, named.map(c => c.id));
    const verdict = await judgeDuplicate({ orgId, label: read.type.label, record, shortlist }, opts.model);
    if (!verdict) {
      return none('the read failed');
    }
    // An id the judge was never shown is not an answer.
    const match = verdict.duplicateOf === null || verdict.relation === 'different' ? null : shortlist.find(c => c.id === verdict.duplicateOf) ?? null;
    const judged = { checked: true, duplicateOf: match?.id ?? null, relation: match ? verdict.relation : 'different' as const, confidence: verdict.confidence, reason: verdict.reason };
    if (!match) {
      return { ...judged, did: verdict.duplicateOf === null || verdict.relation === 'different' ? 'not a duplicate' : 'named a record it was not shown', linked: false, runId: null, line: null };
    }
    if (verdict.confidence < spec.bar) {
      // Below the bar nothing is written and nothing is said: a guess is not
      // something a person should have to dismiss.
      return { ...judged, did: 'below the bar', linked: false, runId: null, line: null };
    }
    return await link(orgId, { type: read.type, id, title: read.row.title, spec, key, match, verdict, origin: payload });
  } catch (err) {
    console.warn('duplicate check failed; the record stands as filed', { orgId, objectId: payload.objectId, message: (err as Error).message });
    return none('the check failed');
  }
}

/**
 * Write the link through the trust ladder: done for you with Undo above the
 * kind's bar, a card if the workspace holds this kind at a person.
 * @param orgId - Tenant.
 * @param a - What to link.
 * @param a.type
 * @param a.id
 * @param a.title
 * @param a.spec
 * @param a.key
 * @param a.match
 * @param a.verdict
 * @param a.origin
 * @param a.origin.conversationId
 * @param a.origin.byPerson
 */
async function link(orgId: string, a: { type: TypeRow; id: number; title: string; spec: DuplicateCheckSpec; key: string; match: DuplicateCandidate; verdict: DuplicateJudgement; origin: { conversationId?: unknown; byPerson?: unknown } }): Promise<DuplicateFinding> {
  const { proposeAction } = await import('@/services/ActionService');
  // The seat that answers for the type (`x-owner`), when it names one.
  const owner = typeof (a.type.schema as Meta | null)?.['x-owner'] === 'string' ? String((a.type.schema as Meta)['x-owner']) : null;
  const conversationId = typeof a.origin.conversationId === 'number' ? a.origin.conversationId : null;
  const as = a.verdict.relation === 'work_on' ? 'Work on' : a.verdict.relation === 'same_fault' ? 'The same fault as' : 'Same as';
  const reason = `${as} #${a.match.id} (${a.match.title}): ${a.verdict.reason}`.slice(0, 500);
  const res = await proposeAction({
    orgId,
    actionId: 'objects.update_meta',
    input: { objectType: a.type.slug, id: a.id, set: { [a.spec.field]: a.match.id }, reason },
    principal: { kind: 'agent', id: `agent:${owner ?? 'duplicate-check'}`, scope: { orgId }, grants: ['*'], autonomy: 2 },
    invokedBy: 'duplicate-check',
    internal: true,
    dedupKey: a.key,
    ...(conversationId ? { origin: { conversationId, byPerson: a.origin.byPerson === true } } : {}),
    proposal: { confidence: a.verdict.confidence, rationale: a.verdict.reason, ...(owner ? { agentSlug: owner } : {}), suggestedDecision: 'approve', suggestedDecisionReason: `It repeats #${a.match.id}; the work is that one's.` },
  });
  // A run this exact link was decided on before is not a new write.
  const done = res.status === 'done' && res.outcome !== 'already_decided';
  return {
    checked: true,
    did: done ? 'linked' : `link ${res.status}`,
    duplicateOf: a.match.id,
    relation: a.verdict.relation,
    confidence: a.verdict.confidence,
    reason: a.verdict.reason,
    linked: done,
    runId: res.runId ?? null,
    line: done
      ? `${as} #${a.match.id} (${a.match.title}), so it was linked as its duplicate and the work stays there: ${a.verdict.reason} Undo on #${a.id} reopens it.`
      : `Looks like #${a.match.id} (${a.match.title}): ${a.verdict.reason} Linking it is on a card (action #${res.runId}).`,
  };
}

/** The duplicate fact a status line draws. */
export type DuplicateFact = NonNullable<RecordStatus['duplicate']>;

/**
 * The record this one duplicates, when its type links duplicates and the
 * link is set — with the run that wrote it, for Undo. Null otherwise.
 * @param orgId - Tenant.
 * @param recordId - The record.
 */
export async function duplicateFactOf(orgId: string, recordId: number): Promise<DuplicateFact | null> {
  const read = await readRecordAndType(orgId, recordId);
  const spec = read ? duplicateCheckOf(read.type.schema) : null;
  const of = read && spec ? Number(read.row.metadata[spec.field] ?? 0) : 0;
  if (!read || !spec || !Number.isInteger(of) || of <= 0) {
    return null;
  }
  const { and, desc, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema, businessObjectSchema } = await import('@/models/Schema');
  const { recordLinksForOrg } = await import('@/services/objects/recordHref');
  const { recordCodeFrom, recordHrefFrom } = await import('@/libs/workspace/recordHref');
  const links = await recordLinksForOrg(orgId);
  const ofRef = { objectType: read.type.slug, id: of };
  const [target] = await db.select({ title: businessObjectSchema.title }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, of))).limit(1);
  // The write that set it, when one did and it still stands: its reason and Undo.
  const [run] = await db
    .select({ id: actionRunSchema.id, input: actionRunSchema.input, proposal: actionRunSchema.proposal })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.dedupKey, linkKey(read.type.slug, recordId, spec.field)), eq(actionRunSchema.status, 'done')))
    .orderBy(desc(actionRunSchema.id))
    .limit(1);
  const setTo = Number(((run?.input as Meta | undefined)?.set as Meta | undefined)?.[spec.field] ?? 0);
  const current = run && setTo === of ? run : null;
  const confidence = (current?.proposal as Meta | null | undefined)?.confidence;
  return {
    of: { id: of, code: recordCodeFrom(links, ofRef), title: target?.title ?? recordCodeFrom(links, ofRef), href: recordHrefFrom(links, ofRef) },
    reason: current ? String((current.proposal as Meta | null | undefined)?.rationale ?? '') || null : null,
    confidence: typeof confidence === 'number' ? confidence : null,
    undoRunId: current?.id ?? null,
  };
}

/**
 * A status with its duplicate fact on it. A duplicate needs nothing from
 * anyone and nothing runs for it: its work is the other record's, so the You
 * line has no move and there is no Next.
 * @param orgId - Tenant.
 * @param status - The status as the report read it.
 */
export async function withDuplicateFact(orgId: string, status: RecordStatus): Promise<RecordStatus> {
  const fact = await duplicateFactOf(orgId, status.record.id).catch(() => null);
  if (!fact) {
    return status;
  }
  return {
    ...status,
    stage: { key: 'duplicate', label: `Duplicate of ${fact.of.code ?? `#${fact.of.id}`}`, tone: 'muted' },
    you: { needsYou: false, line: 'Nothing needs you', why: null, move: null },
    next: null,
    duplicate: fact,
  };
}
