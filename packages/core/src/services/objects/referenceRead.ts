/**
 * WHICH RECORD DID THE PERSON MEAN? — read by a model from their own words,
 * never guessed by the agent that filed it, never matched (2026-10-01, #294).
 *
 * A person asked in chat: "On Stamp's document page, show how many pages the
 * document has". The product manager filed the request under another product
 * (Slate) without looking products up, its story said "on Slate", the default
 * mockup was drawn in Slate's chrome, and the build was refused because Slate
 * has no repo. Nothing read the person's words against the products.
 *
 * A type opts in on its schema, so core names no type and no field:
 *
 *   x-reference-read:
 *     field: product            # the field on the new record that names another record
 *     type: product             # the type it names
 *     key: slug                 # the field on that type the value is (its slug)
 *     describe: [name, tagline, aliases]  # what the judge reads of each candidate
 *     bar: 0.8                  # a confident read above it wins over the filing, with Undo
 *
 * One classifier call reads the person's messages in the conversation the
 * record was filed from, against every record of that type, and returns typed
 * `{match, confidence, quote}`. Code routes on it: a confident read that
 * disagrees with what was filed is written through `objects.update_meta`,
 * done for you with Undo, and the record says so in one line. Below the bar,
 * a read that agrees, a value the model invented, a correction a person
 * undid before, or a filing with no person's words: nothing is written.
 *
 * NEVER BLOCKS FILING and never edits anyone's words: only the reference
 * field moves; the title and story stay as the agent wrote them.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RecordStatus } from '@/libs/factory/liveStatus';
import { z } from 'zod';
import { DEFAULT_AUTO_ACCEPT_CONFIDENCE } from '@/libs/actions/autoAccept';

type Meta = Record<string, unknown>;
type Model = Pick<BaseChatModel, 'bindTools'>;

/** The type's `x-reference-read`, read. */
export type ReferenceReadSpec = { field: string; type: string; key: string; describe: string[]; bar: number };

/** Who the read's writes are invoked by, so its own corrections can be told from anyone else's edit. */
const READER = 'reference-read';

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * The type schema's `x-reference-read` descriptor, or null when it declares none (or a malformed one).
 * @param schema - The object type's JSON schema.
 */
export function referenceReadOf(schema: unknown): ReferenceReadSpec | null {
  const raw = (schema as Meta | null | undefined)?.['x-reference-read'] as Meta | undefined;
  if (!raw || typeof raw !== 'object' || !text(raw.field) || !text(raw.type)) {
    return null;
  }
  const bar = typeof raw.bar === 'number' && raw.bar > 0 && raw.bar <= 1 ? raw.bar : DEFAULT_AUTO_ACCEPT_CONFIDENCE;
  return { field: text(raw.field)!, type: text(raw.type)!, key: text(raw.key) ?? 'slug', describe: strings(raw.describe), bar };
}

/** One record the person could have meant. */
export type ReferenceCandidate = { value: string; title: string; lines: string[] };

/**
 * A candidate as the judge reads it: its value, its title, and the described fields.
 * @param meta - The candidate's fields.
 * @param title - Its title.
 * @param spec - The descriptor.
 */
export function candidateOf(meta: Meta, title: string, spec: ReferenceReadSpec): ReferenceCandidate | null {
  const value = text(meta[spec.key]);
  if (!value) {
    return null;
  }
  const lines = spec.describe.flatMap((f) => {
    const v = meta[f];
    const s = Array.isArray(v) ? strings(v).join(', ') : text(v);
    return s ? [`${f}: ${s}`] : [];
  });
  return { value, title, lines };
}

export const ReferenceJudgementSchema = z.object({
  match: z.string().nullable().describe('The value (the text after "value:") of the listed record the person\'s words name or clearly mean. null when their words do not say which. Only a value from the list.'),
  confidence: z.number().min(0).max(1).describe('How sure you are, 0 to 1, from the person\'s words alone. 0.9+ means they named it, by its name or one it goes by; 0.5 means it is a guess from context.'),
  quote: z.string().max(200).describe('The person\'s own words that settle it, copied exactly. Empty when none do.'),
});
export type ReferenceJudgement = z.infer<typeof ReferenceJudgementSchema>;

const SYSTEM = [
  'A person asked for something in a work app, and it was filed as a record that names one of the records listed below.',
  'Decide which listed record the PERSON meant, from their own words only. A record may go by other names (its aliases, a working or launch name, a short form of its name, its website).',
  'Do not guess from what the request is about: only what the person said settles it. Answer only through the tool.',
].join(' ');

/**
 * The person's words and the candidates, as one read.
 * @param input - What the judge reads.
 * @param input.label - The named type's label ("Product").
 * @param input.words - The person's messages, oldest first.
 * @param input.candidates - Every record they could have meant.
 */
export function judgeText(input: { label: string; words: readonly string[]; candidates: readonly ReferenceCandidate[] }): string {
  return [
    'WHAT THE PERSON SAID:',
    ...input.words.map(w => `> ${w.slice(0, 1_500)}`),
    `${input.label.toUpperCase()} RECORDS:`,
    ...input.candidates.map(c => `- value: ${c.value} — ${c.title}${c.lines.length > 0 ? ` (${c.lines.join('; ')})` : ''}`),
  ].join('\n').slice(0, 12_000);
}

/**
 * Which record the person meant. Typed, or null when the read failed.
 * @param input - What the judge reads.
 * @param input.orgId - The workspace (its classifier key, its spend).
 * @param input.label - The named type's label.
 * @param input.words - The person's messages.
 * @param input.candidates - The records.
 * @param model - Injected in tests.
 */
export async function judgeReference(input: { orgId: string; label: string; words: readonly string[]; candidates: readonly ReferenceCandidate[] }, model?: Model): Promise<ReferenceJudgement | null> {
  try {
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const m = model ?? await (async () => {
      const { buildChatModelForOrg } = await import('@/libs/llm');
      return buildChatModelForOrg('classifier', input.orgId, { temperature: 0, streaming: false, maxTokens: 300 }) as Promise<Model>;
    })();
    const report = tool(async () => 'recorded', { name: 'report_reference', description: 'Report which listed record the person meant.', schema: ReferenceJudgementSchema as never });
    const bound = m.bindTools!([report], { tool_choice: 'report_reference' } as never);
    const res = await bound.invoke([new SystemMessage(SYSTEM), new HumanMessage(judgeText(input))]) as { tool_calls?: Array<{ name: string; args: unknown }> };
    if (!model) {
      const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
      const { FEATURES } = await import('@/libs/Langfuse/features');
      await chargeModelCall({ orgId: input.orgId, feature: FEATURES.RECORD_REFERENCE, role: 'classifier', response: res });
    }
    const call = (res.tool_calls ?? []).find(c => c.name === 'report_reference');
    const parsed = call ? ReferenceJudgementSchema.safeParse(call.args) : null;
    return parsed?.success ? parsed.data : null;
  } catch (err) {
    console.warn('reference read: the read failed', { orgId: input.orgId, message: (err as Error).message });
    return null;
  }
}

/** What the read did, for the caller's log. */
export type ReferenceFinding = {
  checked: boolean;
  did: string;
  /** The value the record named, and the one the person meant, when a correction was written or proposed. */
  from: string | null;
  to: string | null;
  confidence: number | null;
  quote: string | null;
  /** The correction was written (done for you). */
  corrected: boolean;
  /** The run that wrote it, for Undo; or the card, when the trust ladder asked a person. */
  runId: number | null;
  /** One line a person reads, when there is one to say. */
  line: string | null;
};

const none = (did: string, extra: Partial<ReferenceFinding> = {}): ReferenceFinding => ({ checked: false, did, from: null, to: null, confidence: null, quote: null, corrected: false, runId: null, line: null, ...extra });

/**
 * The dedup key `objects.update_meta` gives a write of exactly this field on this record.
 * @param slug - The record's type.
 * @param id - The record.
 * @param field - The field.
 */
function correctionKey(slug: string, id: number, field: string): string {
  return `objects.update_meta:${slug.trim().toLowerCase()}:${id}:${field}`;
}

type Row = { id: number; title: string; metadata: Meta };
type TypeRow = { id: number; slug: string; label: string; schema: unknown };

async function readRecordAndType(orgId: string, id: number): Promise<{ row: Row; type: TypeRow } | null> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const [hit] = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, metadata: businessObjectSchema.metadata, typeId: businessObjectTypeSchema.id, typeSlug: businessObjectTypeSchema.slug, typeLabel: businessObjectTypeSchema.label, typeSchema: businessObjectTypeSchema.schema })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)))
    .limit(1);
  return hit ? { row: { id: hit.id, title: hit.title, metadata: (hit.metadata ?? {}) as Meta }, type: { id: hit.typeId, slug: hit.typeSlug, label: hit.typeLabel, schema: hit.typeSchema } } : null;
}

async function candidatesFor(orgId: string, spec: ReferenceReadSpec): Promise<{ label: string; candidates: ReferenceCandidate[] }> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const rows = await db
    .select({ title: businessObjectSchema.title, metadata: businessObjectSchema.metadata, label: businessObjectTypeSchema.label, status: businessObjectSchema.status })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, spec.type)))
    .limit(100);
  const live = rows.filter(r => r.status !== 'archived');
  return { label: live[0]?.label ?? spec.type, candidates: live.flatMap(r => candidateOf((r.metadata ?? {}) as Meta, r.title, spec) ?? []) };
}

async function runsFor(orgId: string, key: string): Promise<Array<{ id: number; status: string; input: unknown; proposal: unknown; invokedBy: string | null }>> {
  const { and, desc, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  return db.select({ id: actionRunSchema.id, status: actionRunSchema.status, input: actionRunSchema.input, proposal: actionRunSchema.proposal, invokedBy: actionRunSchema.invokedBy }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.dedupKey, key))).orderBy(desc(actionRunSchema.id)).limit(5);
}

/**
 * THE READ, when a record has just been filed (or intake reads it again).
 * Never throws, never blocks: the record stands as filed whatever this finds.
 * @param orgId - Tenant.
 * @param payload - The record, and the conversation it was filed from.
 * @param payload.objectId - The record.
 * @param payload.conversationId - Where it was filed from; the record's `origin` when absent.
 * @param payload.byPerson - Whether a person's turn filed it.
 * @param opts - Options.
 * @param opts.model - The judge's model, injected in tests.
 * @param opts.words - The person's words, injected in tests.
 */
export async function readReference(orgId: string, payload: { objectId?: unknown; conversationId?: unknown; byPerson?: unknown }, opts: { model?: Model; words?: string[] } = {}): Promise<ReferenceFinding> {
  try {
    const id = Number(payload.objectId);
    if (!Number.isInteger(id) || id <= 0) {
      return none('no record named');
    }
    const read = await readRecordAndType(orgId, id);
    const spec = read ? referenceReadOf(read.type.schema) : null;
    if (!read || !spec) {
      return none('the type asks for no reference read');
    }
    const key = correctionKey(read.type.slug, id, spec.field);
    const before = await runsFor(orgId, key);
    if (before.some(r => r.status === 'undone')) {
      return none('a person undid a correction before');
    }
    if (before.some(r => r.status === 'done' || r.status === 'pending')) {
      return none('already read');
    }
    const origin = (read.row.metadata.origin && typeof read.row.metadata.origin === 'object' ? read.row.metadata.origin : {}) as Meta;
    const conversationId = typeof payload.conversationId === 'number' ? payload.conversationId : typeof origin.conversationId === 'number' ? origin.conversationId : null;
    const words = opts.words ?? (conversationId !== null ? await personWords(orgId, conversationId) : []);
    if (words.length === 0) {
      return none('no words of a person to read');
    }
    const { label, candidates } = await candidatesFor(orgId, spec);
    if (candidates.length < 2) {
      return none('nothing to choose between');
    }
    const verdict = await judgeReference({ orgId, label, words, candidates }, opts.model);
    if (!verdict) {
      return none('the read failed');
    }
    const filed = text(read.row.metadata[spec.field]);
    // A value the judge was never shown is not an answer.
    const match = verdict.match === null ? null : candidates.find(c => c.value === verdict.match) ?? null;
    const judged = { checked: true, from: filed, confidence: verdict.confidence, quote: text(verdict.quote) };
    if (!match) {
      return { ...judged, did: verdict.match === null ? 'their words do not say' : 'named a record it was not shown', to: null, corrected: false, runId: null, line: null };
    }
    if (match.value === filed) {
      return { ...judged, did: 'agrees', to: match.value, corrected: false, runId: null, line: null };
    }
    if (verdict.confidence < spec.bar) {
      return { ...judged, did: 'below the bar', to: match.value, corrected: false, runId: null, line: null };
    }
    const fromName = candidates.find(c => c.value === filed)?.title ?? filed ?? 'nothing';
    return await correct(orgId, { type: read.type, id, spec, key, from: filed, fromName, to: match, verdict, conversationId, byPerson: payload.byPerson === true });
  } catch (err) {
    console.warn('reference read failed; the record stands as filed', { orgId, objectId: payload.objectId, message: (err as Error).message });
    return none('the read failed');
  }
}

async function personWords(orgId: string, conversationId: number): Promise<string[]> {
  const { and, desc, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
  const rows = await db
    .select({ content: conversationMessageSchema.content })
    .from(conversationMessageSchema)
    .innerJoin(conversationSchema, eq(conversationSchema.id, conversationMessageSchema.conversationId))
    .where(and(eq(conversationSchema.orgId, orgId), eq(conversationMessageSchema.conversationId, conversationId), eq(conversationMessageSchema.role, 'user')))
    .orderBy(desc(conversationMessageSchema.id))
    .limit(6);
  return rows.map(r => String(r.content ?? '').trim()).filter(Boolean).reverse();
}

/**
 * The line the record says, in the person's words.
 * @param toName - What they meant.
 * @param fromName - What it was filed under.
 * @param quote - Their words that settle it.
 */
export function correctionLine(toName: string, fromName: string, quote: string | null): string {
  return `Filed under ${toName}, not ${fromName}${quote ? `: you said "${quote}"` : ''}.`;
}

async function correct(orgId: string, a: { type: TypeRow; id: number; spec: ReferenceReadSpec; key: string; from: string | null; fromName: string; to: ReferenceCandidate; verdict: ReferenceJudgement; conversationId: number | null; byPerson: boolean }): Promise<ReferenceFinding> {
  const { proposeAction } = await import('@/services/ActionService');
  const owner = typeof (a.type.schema as Meta | null)?.['x-owner'] === 'string' ? String((a.type.schema as Meta)['x-owner']) : null;
  const line = correctionLine(a.to.title, a.fromName, text(a.verdict.quote));
  const res = await proposeAction({
    orgId,
    actionId: 'objects.update_meta',
    input: { objectType: a.type.slug, id: a.id, set: { [a.spec.field]: a.to.value }, reason: line.slice(0, 500) },
    principal: { kind: 'agent', id: `agent:${owner ?? 'reference-read'}`, scope: { orgId }, grants: ['*'], autonomy: 2 },
    invokedBy: READER,
    internal: true,
    dedupKey: a.key,
    ...(a.conversationId ? { origin: { conversationId: a.conversationId, byPerson: a.byPerson } } : {}),
    proposal: { confidence: a.verdict.confidence, rationale: line, ...(owner ? { agentSlug: owner } : {}), suggestedDecision: 'approve', suggestedDecisionReason: `The person's words name ${a.to.title}.` },
  });
  const done = res.status === 'done' && res.outcome !== 'already_decided';
  return {
    checked: true,
    did: done ? 'corrected' : `correction ${res.status}`,
    from: a.from,
    to: a.to.value,
    confidence: a.verdict.confidence,
    quote: text(a.verdict.quote),
    corrected: done,
    runId: res.runId ?? null,
    line: done ? `${line} Undo puts it back.` : `${line.replace(/\.$/, '')}? Correcting it is on a card (action #${res.runId}).`,
  };
}

/** The correction fact a status line draws. */
export type ReferenceFact = NonNullable<RecordStatus['corrected']>;

/**
 * The correction the read made on a record, while it still stands — its line
 * and the run to undo. Null when none was made, or it was undone.
 * @param orgId - Tenant.
 * @param recordId - The record.
 */
export async function referenceFactOf(orgId: string, recordId: number): Promise<ReferenceFact | null> {
  const read = await readRecordAndType(orgId, recordId);
  const spec = read ? referenceReadOf(read.type.schema) : null;
  if (!read || !spec) {
    return null;
  }
  // Only this read's own write is a correction to say; a person's edit of the field is theirs.
  const [run] = (await runsFor(orgId, correctionKey(read.type.slug, recordId, spec.field))).filter(r => r.invokedBy === READER);
  const set = ((run?.input as Meta | undefined)?.set ?? {}) as Meta;
  if (!run || run.status !== 'done' || set[spec.field] !== read.row.metadata[spec.field]) {
    return null;
  }
  const line = text((run.proposal as Meta | null | undefined)?.rationale);
  return line ? { line, undoRunId: run.id } : null;
}

/**
 * A status with its correction on it, drawn as one line with Undo.
 * @param orgId - Tenant.
 * @param status - The status as the report read it.
 */
export async function withReferenceFact(orgId: string, status: RecordStatus): Promise<RecordStatus> {
  const fact = await referenceFactOf(orgId, status.record.id).catch(() => null);
  return fact ? { ...status, corrected: fact } : status;
}
