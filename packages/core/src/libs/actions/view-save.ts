import type { Action } from './types';
import { z } from 'zod';

/**
 * view.save — keep a state query as the person's own saved view
 * (`services/state/state.ts`), optionally read in their brief and their
 * "what is waiting on me".
 *
 * Two ways in, one action. The person asks ("keep an eye on overdue invoices
 * over $5k") and their word runs it. Or `query_state` notices they have asked
 * the same question three times in two weeks (`services/state/state.ts`)
 * and the agent, in the turn, offers it as a Decision card — the system never
 * files the offer on its own. Always the asker's own view; a schedule or
 * automation built on it is a separate ask on the trust ladder. Reversible:
 * Undo removes a new view or puts the replaced one back.
 */

const VIEW_SAVE = 'view.save';

const input = z.object({
  /** What to call it, in the person's words: "Big invoices overdue". */
  name: z.string().min(2).max(80),
  /** One sentence on what it shows. */
  description: z.string().min(2).max(300),
  /** The `query_state` query: sets, filter, sort, limit. */
  query: z.object({
    sets: z.array(z.string()).min(1),
    filter: z.record(z.string(), z.unknown()).optional(),
    sort: z.object({ facet: z.string(), dir: z.enum(['asc', 'desc']) }).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  /** Read it in the person's brief and "what is waiting on me". */
  in_brief: z.boolean().optional(),
  reason: z.string().min(1).max(300).optional(),
});

export const viewSaveAction: Action<typeof input> = {
  id: VIEW_SAVE,
  name: 'Save a view',
  description: 'Keep a state query (the kind query_state runs) as the person\'s own named view, so they can ask for it by name and, if they want, see it in their brief and in "what is waiting on me". Use it when the person asks to keep an eye on something, or offer it when query_state says they keep asking the same question. Only ever the asker\'s own view. Reversible.',
  inputSchema: input,
  grant: 'update_profile',
  external: false,
  dedupKeyFor: i => `view.save:${i.name.toLowerCase()}`,
  async precheck(ctx, i) {
    const { personBehind } = await import('@/services/chat/conversationChannel');
    const person = await personBehind(ctx.orgId, ctx.invokedBy);
    if (!person) {
      return 'A view belongs to a person, and this turn has none behind it. Ask them to sign in to Vocion.';
    }
    const { checkQuery } = await import('@/services/state/state');
    const problems = checkQuery(i.query as never);
    return problems.length > 0 ? `That query cannot run: ${problems.map(p => p.message).join('; ')}.` : undefined;
  },
  async reviewCard(_ctx, i) {
    return {
      title: `Save a view: ${i.name}`,
      system: 'Views',
      ...(i.reason ? { summary: i.reason } : {}),
      fields: [
        { label: 'Shows', value: i.description },
        { label: 'Reads', value: i.query.sets.join(', ') },
        { label: 'Filter', value: JSON.stringify(i.query.filter ?? {}) },
        { label: 'In your brief', value: i.in_brief ? 'Yes' : 'No' },
      ],
      nextAction: 'Approving keeps it as your view: ask for it by name any time. Undo removes it.',
      verbs: { approve: 'Save the view', reject: 'Don\'t save' },
    };
  },
  async execute(ctx, i) {
    const { personBehind } = await import('@/services/chat/conversationChannel');
    const person = await personBehind(ctx.orgId, ctx.invokedBy);
    if (!person) {
      throw new Error('No Vocion person behind this turn.');
    }
    const { savePersonView } = await import('@/services/state/state');
    const { view, previous } = await savePersonView({
      orgId: ctx.orgId,
      userId: person.userId,
      name: i.name,
      description: i.description,
      query: i.query as never,
      inBrief: i.in_brief ?? false,
      createdBy: ctx.proposedBy?.startsWith('agent:') ? 'agent' : person.userId,
    });
    return { viewId: view.id, userId: person.userId, slug: view.slug, previous, line: `Saved "${view.name}" as ${person.name}'s view (${view.slug})${view.inBrief ? ', in their brief' : ''}.` };
  },
  async undo(ctx, _i, result) {
    const userId = typeof result?.userId === 'string' ? result.userId : null;
    const viewId = typeof result?.viewId === 'number' ? result.viewId : null;
    if (!userId || !viewId) {
      throw new Error('This run recorded no view, so there is nothing to undo.');
    }
    const previous = result?.previous as { name: string; description: string; query: Record<string, unknown>; inBrief: boolean; slug: string } | null | undefined;
    const { deletePersonView } = await import('@/services/state/state');
    await deletePersonView(viewId, userId);
    if (previous) {
      const [{ db }, { stateViewSchema }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema')]);
      await db.insert(stateViewSchema).values({ scope: 'person', orgId: ctx.orgId, userId, slug: previous.slug, name: previous.name, description: previous.description, query: previous.query, inBrief: previous.inBrief, createdBy: userId });
      return { line: `Put back the earlier "${previous.name}".` };
    }
    return { line: 'Removed the view.' };
  },
};
