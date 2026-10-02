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
 * A change on a record's page belongs on THAT record, never in a filing
 * beside it. So a filing (`objects.propose_candidate`, from
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
  if (!text.trim() || intent.asks === 'file') {
    return null;
  }
  const kind = opts.objectType.replace(/[_-]+/g, ' ');
  const anchor = opts.anchor;
  if (anchor && anchor.objectType === opts.objectType) {
    if (intent.asks !== 'change') {
      return null;
    }
    return `Not filed: the person is on ${kind} #${anchor.id}'s page and asked to change it, so the change belongs on ${kind} #${anchor.id}, not on a new ${kind}. Write it with update_object (object_type "${opts.objectType}", id ${anchor.id}), each field you change with its whole new value; it lands as a new version of #${anchor.id}. File a separate ${kind} only when the person asks for a new or separate one.`;
  }
  // Only a filing of the SAME kind as the record they want changed is the
  // change misfiled (#232); a plan for the request they asked to restart is
  // not (conversation 391, #246). When the read names no kind, nothing is
  // refused: not knowing is never a reason to block the person.
  if (intent.asks !== 'change' || intent.changed_record_type !== opts.objectType) {
    return null;
  }
  const said = text.trim().split('\n')[0]!.slice(0, 80);
  return `Not filed: the person asked to change something already there ("${said}${said.length === 80 ? '…' : ''}"), and no ${kind} is open on their page, so there is nothing new to file. Find the ${kind} they mean (lookup_objects, type "${opts.objectType}") and write the change to it with update_object. If none matches, ask them which ${kind} they mean, in one question, and file a new one only when they say it is new.`;
}

/**
 * The record a change on this page belongs to: the page's `object`, by id
 * and, once the page record is typed (`services/chat/pageRecord.ts`), its
 * type — `/dashboard/p/feature/124` is request 124. Null for a page about no
 * record.
 * @param ref - The page context's record.
 * @param ref.type - Its ref type (`object` is a record).
 * @param ref.id - Its id.
 * @param ref.objectType - Its object type, once typed.
 */
export function owedChangeTarget(ref: { type: string; id: string; objectType?: string } | null | undefined): { id: number; objectType: string | null } | null {
  if (ref?.type !== 'object' || !/^\d+$/.test(ref.id)) {
    return null;
  }
  return { id: Number(ref.id), objectType: ref.objectType ?? null };
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
