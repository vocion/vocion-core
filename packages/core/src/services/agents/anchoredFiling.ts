/**
 * A CHANGE IS WRITTEN TO THE RECORD IT IS ABOUT, NEVER FILED AS A NEW ONE.
 *
 * Conversation 367 (2026-09-29 05:13Z, the PM flow matrix, s5): the person
 * wrote "Change this: the note is at most 280 characters, the sender can edit
 * or remove it any time, and viewers see it only after the gate (never on the
 * public preview)." The page named no record (the feature list — the MCP
 * filing it meant to change had been refused), the router scored the words
 * and chose the designer, and the designer read "Change this:" as "file a new
 * request with those specs" and filed request #232 (action run 5042). The
 * person asked for a change and got a second record.
 *
 * The owed-change pass (`owedWriteBackstop.changeOwedRecord`) already makes a
 * change on a record's page land on THAT record. Nothing stopped the other
 * half: a filing beside it. So a filing (`objects.propose_candidate`, from
 * `file_<type>` or propose_action alike — both go through `runProposal`) made
 * in a person's turn is refused, with what to do instead, when:
 *
 *   - the page is a record of the SAME type and the person's words ask to
 *     change it (`asksToChange`, the same predicate that owes the change) —
 *     the change is `update_object` on that record, a new version of it; or
 *   - the person's words aim a change at something already there ("Change
 *     this: …", "edit it") and no record of that type is open — there is
 *     nothing new to file, only a record to find, or one question to ask.
 *
 * Unless the person asked for a new one: "file a request", "a separate
 * feature", "its own ticket" files as always. The gate reads the person's
 * words and the page, never the model's account of them.
 */

import type { TurnIntent } from './turnJudge';
import type { RuntimeContext } from './types';
import { owedChangeTarget } from './owedWriteBackstop';

/**
 * The answer to send instead of filing, or null to file.
 * @param opts - The filing and where it was asked for.
 * @param opts.message - The person's message this turn (quoted in the refusal).
 * @param opts.intent - What they want, as the turn's intent read says.
 * @param opts.objectType - The type being filed.
 * @param opts.anchor - The page's record, typed (`owedChangeTarget`), or null.
 */
export function anchoredFilingRefusal(opts: { message: string; intent: TurnIntent; objectType: string; anchor: { id: number; objectType: string | null } | null }): string | null {
  const text = (opts.message ?? '').split('\n\n--- ')[0] ?? '';
  // What they meant is the turn's intent read, never their wording.
  const { intent } = opts;
  if (!text.trim() || intent.files_new_record) {
    return null;
  }
  const kind = opts.objectType.replace(/[_-]+/g, ' ');
  const anchor = opts.anchor;
  if (anchor && anchor.objectType === opts.objectType) {
    if (!intent.changes_page_record) {
      return null;
    }
    return `Not filed: the person is on ${kind} #${anchor.id}'s page and asked to change it, so the change belongs on ${kind} #${anchor.id}, not on a new ${kind}. Write it with update_object (object_type "${opts.objectType}", id ${anchor.id}), each field you change with its whole new value; it lands as a new version of #${anchor.id}. File a separate ${kind} only when the person asks for a new or separate one.`;
  }
  if (!intent.changes_existing_record) {
    return null;
  }
  const said = text.trim().split('\n')[0]!.slice(0, 80);
  return `Not filed: the person asked to change something already there ("${said}${said.length === 80 ? '…' : ''}"), and no ${kind} is open on their page, so there is nothing new to file. Find the ${kind} they mean (lookup_objects, type "${opts.objectType}") and write the change to it with update_object. If none matches, ask them which ${kind} they mean, in one question, and file a new one only when they say it is new.`;
}

/**
 * The person's latest message in the turn's conversation — for a tool call
 * made out of process, whose context carries no `turnMessage`. The route
 * stores the message before the agent runs.
 * @param ctx - The turn.
 */
async function latestPersonMessage(ctx: Pick<RuntimeContext, 'orgId' | 'conversationId'>): Promise<string | null> {
  if (!ctx.conversationId) {
    return null;
  }
  const { and, desc, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
  const [row] = await db
    .select({ content: conversationMessageSchema.content })
    .from(conversationMessageSchema)
    .innerJoin(conversationSchema, eq(conversationSchema.id, conversationMessageSchema.conversationId))
    .where(and(eq(conversationSchema.orgId, ctx.orgId), eq(conversationMessageSchema.conversationId, ctx.conversationId), eq(conversationMessageSchema.role, 'user')))
    .orderBy(desc(conversationMessageSchema.id))
    .limit(1);
  return typeof row?.content === 'string' ? row.content : null;
}

/**
 * Should this filing be refused as a change in disguise? Reads the person's
 * message (the turn's, else the conversation's latest) and the page's record.
 * Never throws: a check that cannot read files as before.
 * @param ctx - The turn.
 * @param input - The filing's `objects.propose_candidate` input.
 */
export async function anchoredFilingCheck(ctx: RuntimeContext, input: Record<string, unknown>): Promise<string | null> {
  const objectType = typeof input.objectType === 'string' ? input.objectType : null;
  if (!objectType) {
    return null;
  }
  try {
    const message = ctx.turnMessage ?? await latestPersonMessage(ctx);
    if (!message) {
      return null;
    }
    const target = owedChangeTarget(ctx.pageContext?.record);
    let anchor = target;
    if (target && !target.objectType) {
      // The page's typed ref says what the record is (`pageRecord.ts`); an
      // untyped one is read, so a `feature` page still reads as a request.
      const { getBusinessObject } = await import('@/services/BusinessObjectService');
      const row = await getBusinessObject(target.id, ctx.orgId);
      anchor = { id: target.id, objectType: (row as { type?: { slug?: string } } | null)?.type?.slug ?? null };
    }
    return anchoredFilingRefusal({ message, intent: await intentOf(ctx, message), objectType, anchor });
  } catch (err) {
    console.warn('anchored filing check failed', { orgId: ctx.orgId, message: (err as Error).message });
    return null;
  }
}

/**
 * What the person wants: the turn's own intent read, or — for a tool call
 * made out of process, with no turn around it — the same read, made now.
 * @param ctx - The turn.
 * @param message - The person's latest message.
 */
async function intentOf(ctx: RuntimeContext, message: string): Promise<TurnIntent> {
  if (ctx.turnIntent) {
    return ctx.turnIntent;
  }
  const { readIntent } = await import('./turnJudge');
  return readIntent({ orgId: ctx.orgId, message, page: ctx.pageContext?.record?.label ?? null });
}

/* ------------------------------------------------------------------ */
/* An ask about the record the person is changing                      */
/* ------------------------------------------------------------------ */

/** How far ahead the recommended option has to be for the choice to be the agent's. */
const CLEAR_LEAD = 0.2;

type AskOption = string | { label?: string; recommended?: boolean; confidence?: number };

/**
 * Whether a ruling's options already carry the answer: a recommended option
 * whose confidence leads every other scored one by {@link CLEAR_LEAD}. Two
 * readings that are equally good carry no such lead.
 * @param options - The ask's options.
 */
export function hasClearFavourite(options: readonly AskOption[] | undefined): boolean {
  const scored = (options ?? []).filter((o): o is Exclude<AskOption, string> => typeof o === 'object' && o !== null);
  const pick = scored.find(o => o.recommended === true && typeof o.confidence === 'number');
  if (!pick) {
    return false;
  }
  const rivals = scored.filter(o => o !== pick && typeof o.confidence === 'number').map(o => o.confidence as number);
  return pick.confidence! - (rivals.length > 0 ? Math.max(...rivals) : 0) >= CLEAR_LEAD;
}

/**
 * A CONFLICT FOUND WHILE DOING THE WORK IS AN EDIT, NOT AN ASK.
 *
 * Request #224, 2026-09-29 16:34Z: asked on the feature page to add mocks,
 * the designer drew, found that a criterion did not fit the drawing, and filed
 * a ruling — recommending its own answer at 0.85 over 0.3 — instead of
 * changing the request. Chris: *"if we needed to adjust the plan, that should
 * go to the feature text and refresh that page."*
 *
 * So in a person's turn on a record's page, an ask ABOUT that record (its
 * refs name it, or it names none) is refused with what to write instead when:
 *
 *   - it is a `ruling` whose recommended option clearly leads — the agent
 *     already has the answer, so it is an edit; or
 *   - it is an `input` or `ruling` and the person's words asked for work on
 *     the record ("add mocks to this", "change it") — the agent is doing the
 *     work and a gap in it is the agent's to close — unless the options are
 *     equally good, which is the one choice that is the person's.
 *
 * The person asking for a choice always gets one. Approvals, recommendations,
 * credentials, merges and gates are never touched: those are decisions only
 * a person can make.
 * @param opts - The ask and where it was filed.
 * @param opts.message - The person's message this turn.
 * @param opts.intent
 * @param opts.anchor - The page's record, typed (`owedChangeTarget`), or null.
 * @param opts.kind - The ask's kind.
 * @param opts.options - Its options.
 * @param opts.objectRefs - The records it names.
 */
export function anchoredAskRefusal(opts: {
  message: string;
  intent: TurnIntent;
  anchor: { id: number; objectType: string | null } | null;
  kind: string | undefined;
  options?: readonly AskOption[];
  objectRefs?: ReadonlyArray<{ type: string; id: string | number }>;
}): string | null {
  const text = (opts.message ?? '').split('\n\n--- ')[0] ?? '';
  const anchor = opts.anchor;
  if (!anchor || !text.trim() || opts.intent.wants_to_choose) {
    return null;
  }
  if (opts.kind !== 'ruling' && opts.kind !== 'input') {
    return null;
  }
  const refs = opts.objectRefs ?? [];
  if (refs.length > 0 && !refs.some(r => Number(r.id) === anchor.id)) {
    return null;
  }
  const favourite = opts.kind === 'ruling' && hasClearFavourite(opts.options);
  const working = opts.intent.changes_page_record || opts.intent.wants_work_on_record;
  const equal = opts.kind === 'ruling' && !favourite && (opts.options?.length ?? 0) >= 2;
  if (!favourite && !(working && !equal)) {
    return null;
  }
  const kind = (anchor.objectType ?? 'record').replace(/[_-]+/g, ' ');
  const why = favourite
    ? 'you already recommend one answer well ahead of the others, so the choice is yours to make'
    : 'the person asked you to do this work on it, so a gap you found in it is yours to close';
  return `Not asked: this is about ${kind} #${anchor.id}, the record on the person's page, and ${why}. Edit ${kind} #${anchor.id} instead — update_object${anchor.objectType ? ` (object_type "${anchor.objectType}", id ${anchor.id})` : ` (id ${anchor.id})`} with the corrected field (e.g. the acceptance criterion, whole) — which lands as a new version on their page, and say what you changed in one line. Ask only when two readings are equally good and the choice is the person's.`;
}

/**
 * Should this ask be refused as an edit in disguise? Reads the person's
 * message and the page's record; never throws, and never gates an
 * unattended run (no person is on a page there).
 * @param ctx - The turn.
 * @param input - The ask as `file_ask` received it.
 * @param input.kind - Its kind.
 * @param input.options - Its options.
 * @param input.objectRefs - The records it names.
 */
export async function anchoredAskCheck(ctx: RuntimeContext, input: { kind?: string; options?: readonly AskOption[]; objectRefs?: ReadonlyArray<{ type: string; id: string | number }> }): Promise<string | null> {
  if (ctx.missionRunId) {
    return null;
  }
  try {
    const target = owedChangeTarget(ctx.pageContext?.record);
    if (!target) {
      return null;
    }
    const message = ctx.turnMessage ?? await latestPersonMessage(ctx);
    if (!message) {
      return null;
    }
    let anchor = target;
    if (!target.objectType) {
      const { getBusinessObject } = await import('@/services/BusinessObjectService');
      const row = await getBusinessObject(target.id, ctx.orgId);
      anchor = { id: target.id, objectType: (row as { type?: { slug?: string } } | null)?.type?.slug ?? null };
    }
    return anchoredAskRefusal({ message, intent: await intentOf(ctx, message), anchor, kind: input.kind ?? 'approval', options: input.options, objectRefs: input.objectRefs });
  } catch (err) {
    console.warn('anchored ask check failed', { orgId: ctx.orgId, message: (err as Error).message });
    return null;
  }
}
