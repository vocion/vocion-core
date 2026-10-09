/**
 * WHAT IS WAITING ON THE PERSON, AND WHAT THEY SAID.
 *
 * The decisions open on a record's page (its asks and pending proposals),
 * described for an agent, and the person's own recent messages — what
 * `turnJudge.saidToDecide` reads before a decide tool acts for them.
 */

/**
 * The person's own words: the message before the page context the route
 * appends ("--- where I am ---").
 * @param message - The message as the model received it.
 */
export function personWords(message: string | null | undefined): string {
  return ((message ?? '').split('\n\n--- ')[0] ?? '').trim();
}

/** A decision on a proposal. */
export type Decision = 'approve' | 'reject' | 'defer';

export type OpenDecision = {
  kind: 'proposal' | 'ask';
  id: number;
  title: string;
  /** A proposal's action. */
  actionId?: string;
  /** An ask's answers. */
  options?: Array<{ id: string; label: string; recommended?: boolean }>;
};

/**
 * The decisions, as the model reads them — one line each, with the call
 * that decides it.
 * @param decisions - What is waiting.
 */
export function describeOpenDecisions(decisions: readonly OpenDecision[]): string {
  return decisions.map(d => d.kind === 'proposal'
    ? `- proposal #${d.id} (${d.actionId ?? 'an action'}): ${d.title} — decide_proposal id ${d.id}`
    : `- ask #${d.id}: ${d.title}${d.options && d.options.length > 0 ? ` — answers: ${d.options.map(o => `${o.id} ("${o.label}")`).join(', ')}` : ' — answers: approve, reject'} — decide_ask id ${d.id}`).join('\n');
}

/**
 * Everything waiting on a person about the record on their page: its open
 * asks and the pending proposals whose input names it. Never throws.
 * @param orgId - The workspace.
 * @param recordId - The page's record.
 */
export async function openDecisionsOn(orgId: string, recordId: number): Promise<OpenDecision[]> {
  try {
    const { and, eq, or, sql } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { actionRunSchema, askSchema } = await import('@/models/Schema');
    const id = String(recordId);
    const [asks, runs] = await Promise.all([
      db.select({ id: askSchema.id, title: askSchema.title, options: askSchema.options })
        .from(askSchema)
        .where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), sql`${askSchema.objectRefs} @> ${JSON.stringify([{ id }])}::jsonb`))
        .limit(10),
      db.select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, input: actionRunSchema.input, proposal: actionRunSchema.proposal })
        .from(actionRunSchema)
        .where(and(
          eq(actionRunSchema.orgId, orgId),
          eq(actionRunSchema.status, 'pending'),
          or(sql`${actionRunSchema.input}->>'requestId' = ${id}`, sql`${actionRunSchema.input}->>'objectId' = ${id}`, sql`${actionRunSchema.input}->>'id' = ${id}`),
        ))
        .limit(10),
    ]);
    return [
      ...runs.map(r => ({ kind: 'proposal' as const, id: r.id, actionId: r.actionId, title: proposalTitle(r.actionId, r.input, r.proposal) })),
      ...asks.map(a => ({ kind: 'ask' as const, id: a.id, title: a.title, options: (a.options ?? []).map(o => ({ id: String(o.id), label: String(o.label), ...(o.recommended ? { recommended: true } : {}) })) })),
    ];
  } catch (err) {
    console.warn('open decisions read failed', { orgId, recordId, message: (err as Error).message });
    return [];
  }
}

function proposalTitle(actionId: string, input: Record<string, unknown> | null, proposal: unknown): string {
  const p = (proposal ?? {}) as { label?: unknown; rationale?: unknown };
  const said = typeof p.label === 'string' ? p.label : typeof input?.reason === 'string' ? input.reason : typeof p.rationale === 'string' ? p.rationale : '';
  return `${actionId}${said ? `: ${said.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`;
}

/**
 * Did the person, in their own words on the page they are on, tell the agent
 * to take this decision? The one consent read every decide path uses: their
 * latest messages and the page's record, so "build this" means that record.
 * @param ctx - The turn.
 * @param ctx.orgId - The workspace.
 * @param ctx.conversationId - The conversation.
 * @param ctx.turnMessage - This turn's message.
 * @param ctx.pageContext - The page they are on.
 * @param decision - The decision, as a sentence.
 */
export async function personSaidToDecide(ctx: { orgId: string; conversationId?: number | null; turnMessage?: string; pageContext?: import('@/services/chat/pageContext').PageContext }, decision: string): Promise<{ said: boolean; quote: string | null }> {
  const { saidToDecide } = await import('./turnJudge');
  const page = ctx.pageContext?.record?.label ?? ctx.pageContext?.title ?? null;
  return saidToDecide({ orgId: ctx.orgId, messages: await personMessages(ctx), decision, page });
}

/**
 * The person's words a decision tool is gated on: this turn's message
 * (`ctx.turnMessage`, else the conversation's latest), then the one before.
 * Empty when the turn has no conversation. Never throws.
 * @param ctx - The turn.
 * @param ctx.orgId - The workspace.
 * @param ctx.conversationId - The conversation.
 * @param ctx.turnMessage - This turn's message, as typed.
 */
export async function personMessages(ctx: { orgId: string; conversationId?: number | null; turnMessage?: string }): Promise<string[]> {
  let stored: string[] = [];
  if (ctx.conversationId) {
    try {
      const { and, desc, eq, inArray } = await import('drizzle-orm');
      const { db } = await import('@/libs/DB');
      const { conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
      const rows = await db
        .select({ content: conversationMessageSchema.content })
        .from(conversationMessageSchema)
        .innerJoin(conversationSchema, eq(conversationSchema.id, conversationMessageSchema.conversationId))
        // A Decision answered on its card is the person's word too: what they
        // chose, as the typed record the row holds.
        .where(and(eq(conversationSchema.orgId, ctx.orgId), eq(conversationMessageSchema.conversationId, ctx.conversationId), inArray(conversationMessageSchema.role, ['user', 'decision'])))
        .orderBy(desc(conversationMessageSchema.id))
        .limit(2);
      stored = rows.map(r => String(r.content ?? ''));
    } catch {
      stored = [];
    }
  }
  if (ctx.turnMessage === undefined) {
    return stored;
  }
  // The route stores the message before the agent runs, so the newest stored
  // row is this turn's; the one before it is the previous message.
  const previous = stored[0] !== undefined && personWords(stored[0]) === personWords(ctx.turnMessage) ? stored[1] : stored[0];
  return [ctx.turnMessage, ...(previous !== undefined ? [previous] : [])];
}
