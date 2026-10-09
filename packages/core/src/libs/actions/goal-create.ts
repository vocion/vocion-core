import type { Action, ReviewCard } from './types';
import type { GoalLink, GoalMeasure } from '@/libs/objectives/goal';
import { z } from 'zod';
import { GOAL_LINK_KINDS, horizonLabel, MAX_MILESTONES, measureProblem, milestonesFrom, MIN_MILESTONES, parseHorizon } from '@/libs/objectives/goal';

/**
 * goal.create — set one of the person's goals, as a Decision they approve.
 *
 * "Make this a goal" in any chat, or the agent noticing an open-ended aim
 * ("I need to get back to everyone from the expo"), leads the agent to draft
 * the goal in the turn: a title, a horizon, a measure — a saved view that
 * fits, counted live, or 3–7 milestones it proposes — and the work to link.
 * The draft is this card: the person approves it, edits it in place first,
 * or declines. A goal is never made silently; the card always shows, even
 * when the person asked for it (`goal_create` emits it directly rather than
 * through the consent path), because the measure is the agent's proposal and
 * is worth one look. Undo removes the goal.
 */

export const GOAL_CREATE_ACTION_ID = 'goal.create';

const link = z.object({ kind: z.enum(GOAL_LINK_KINDS), id: z.string().min(1).max(120), label: z.string().max(160).optional() });

const measure = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('view'),
    /** A saved view's slug (`query_state` list: true shows them). */
    view: z.string().min(1).max(80),
    /** The facets that make a row of the view count as done: {"reply_state": "replied"}. */
    done: z.record(z.string(), z.unknown()).optional(),
    /** How many make the goal done. */
    target: z.number().int().min(1).max(100_000).optional(),
    /** What a done row is called: "contacted". */
    unit: z.string().max(40).optional(),
  }),
  z.object({
    kind: z.literal('milestones'),
    milestones: z.array(z.object({ label: z.string().min(2).max(160), link: link.optional() })).min(MIN_MILESTONES).max(MAX_MILESTONES),
  }),
]);

const input = z.object({
  /** The goal in the person's words: "Follow up with every Northwind Expo contact". */
  title: z.string().min(3).max(200),
  /** A due date (`2026-11-30`) or a quarter (`2026-Q4`). */
  horizon: z.string().min(2).max(20),
  measure,
  links: z.array(link).max(20).optional(),
  /** Read it in the person's Friday review. */
  weekly_review: z.boolean().optional(),
  next_steps: z.array(z.object({ label: z.string().min(2).max(80), prompt: z.string().min(2).max(400) })).max(3).optional(),
  reason: z.string().max(300).optional(),
});

export type GoalCreateInput = z.infer<typeof input>;

/**
 * The measure as a person reads it.
 * @param m - The measure.
 */
function measureText(m: GoalCreateInput['measure']): string {
  if (m.kind === 'milestones') {
    return `${m.milestones.length} milestones`;
  }
  const done = m.done && Object.keys(m.done).length > 0 ? ` · done when ${Object.entries(m.done).map(([k, v]) => `${k} = ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')}` : '';
  return `View “${m.view}”${done}${m.target ? ` · target ${m.target}${m.unit ? ` ${m.unit}` : ''}` : ''}`;
}

/**
 * The draft as the editable text on the card. Pure.
 * @param i - The input.
 */
export function goalDraftText(i: GoalCreateInput): string {
  const out = [`Title: ${i.title}`, `Horizon: ${i.horizon}`];
  if (i.measure.kind === 'milestones') {
    out.push('Milestones:', ...i.measure.milestones.map((m, n) => `${n + 1}. ${m.label}`));
  } else {
    out.push(`Measure: ${measureText(i.measure)}`);
    if (i.measure.target) {
      out.push(`Target: ${i.measure.target}`);
    }
  }
  out.push(`Weekly review: ${i.weekly_review ? 'yes' : 'no'}`);
  return out.join('\n');
}

/**
 * The input after the person edited the draft on the card: the title, the
 * horizon, the target, the milestones (one per line) and the weekly review
 * are read back; anything else on the card stays as the agent drafted it.
 * Lines it cannot read are left alone rather than guessed at. Pure.
 * @param i - The drafted input.
 * @param body - The edited text.
 */
export function applyGoalDraft(i: GoalCreateInput, body: string): GoalCreateInput {
  const lines = body.split('\n').map(l => l.trim());
  const field = (name: string) => lines.find(l => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))?.slice(name.length + 1).trim();
  const next: GoalCreateInput = { ...i, measure: { ...i.measure } as GoalCreateInput['measure'] };
  const title = field('Title');
  if (title && title.length >= 3) {
    next.title = title.slice(0, 200);
  }
  const horizon = field('Horizon');
  if (horizon && parseHorizon(horizon)) {
    next.horizon = horizon;
  }
  const review = field('Weekly review');
  if (review) {
    next.weekly_review = /^(?:y|yes|on|true)$/i.test(review);
  }
  if (next.measure.kind === 'view') {
    const target = Number(field('Target'));
    if (Number.isInteger(target) && target > 0) {
      next.measure = { ...next.measure, target };
    }
  } else {
    const start = lines.findIndex(l => /^milestones:?$/i.test(l));
    if (start !== -1) {
      const items: string[] = [];
      for (const l of lines.slice(start + 1)) {
        const m = /^(?:\d+[.)]|[-*•])\s*(\S.*)$/.exec(l);
        if (!m) {
          break;
        }
        items.push(m[1]!.trim());
      }
      if (items.length >= MIN_MILESTONES && items.length <= MAX_MILESTONES) {
        const was = new Map(next.measure.milestones.map(m => [m.label.toLowerCase(), m]));
        next.measure = { kind: 'milestones', milestones: items.map(label => ({ label, ...(was.get(label.toLowerCase())?.link ? { link: was.get(label.toLowerCase())!.link } : {}) })) };
      }
    }
  }
  return next;
}

/**
 * The stored measure for an input.
 * @param m - The input's measure.
 */
export function storedMeasure(m: GoalCreateInput['measure']): GoalMeasure {
  return m.kind === 'milestones'
    ? { kind: 'milestones', milestones: milestonesFrom(m.milestones.map(x => ({ label: x.label, ...(x.link ? { link: x.link as GoalLink } : {}) }))) }
    : { kind: 'view', view: m.view, ...(m.done ? { done: m.done } : {}), ...(m.target ? { target: m.target } : {}), ...(m.unit ? { unit: m.unit } : {}) };
}

/**
 * The person whose goal this is.
 * @param ctx - The action's context.
 * @param ctx.orgId - The workspace.
 * @param ctx.invokedBy - Who.
 * @param ctx.origin - Where it was proposed.
 * @param ctx.origin.userId
 */
async function ownerOf(ctx: { orgId: string; invokedBy?: string; origin?: { userId?: string | null } }): Promise<{ userId: string; name: string } | null> {
  if (ctx.origin?.userId) {
    return { userId: ctx.origin.userId, name: '' };
  }
  const { personBehind } = await import('@/services/chat/conversationChannel');
  return personBehind(ctx.orgId, ctx.invokedBy);
}

export const goalCreateAction: Action<typeof input> = {
  id: GOAL_CREATE_ACTION_ID,
  name: 'Set a goal',
  description: 'Set one of the person\'s goals — an outcome they own past this conversation, with a horizon and a measure: a saved view counted live (with the facets that mark a row done, or a target), or 3–7 milestones. Draft it when the person says "make this a goal" or states an open-ended aim; prefer the goal_create tool, which checks the view and drafts the card. Always the asker\'s own goal. Undo removes it.',
  inputSchema: input,
  grant: 'update_profile',
  external: false,
  dedupKeyFor: i => `goal.create:${i.title.trim().toLowerCase()}`,
  async precheck(ctx, i) {
    const owner = await ownerOf(ctx);
    if (!owner) {
      return 'A goal belongs to a person, and this turn has none behind it. Ask them to sign in to Vocion.';
    }
    if (!parseHorizon(i.horizon)) {
      return `"${i.horizon}" is not a horizon: give a date (2026-11-30) or a quarter (2026-Q4).`;
    }
    const problem = measureProblem(storedMeasure(i.measure));
    if (problem) {
      return problem;
    }
    if (i.measure.kind === 'view') {
      const { viewBySlug } = await import('@/services/state/state');
      const view = await viewBySlug(i.measure.view, { orgId: ctx.orgId, userId: owner.userId });
      if (!view) {
        return `There is no saved view "${i.measure.view}" here. Use one query_state lists, save one first (view.save), or measure the goal by milestones.`;
      }
    }
    return undefined;
  },
  async reviewCard(_ctx, i): Promise<ReviewCard> {
    const horizon = parseHorizon(i.horizon);
    return {
      title: `Set a goal: ${i.title}`,
      system: 'Goals',
      headline: `Approving sets “${i.title}” as your goal${horizon ? `, ${horizonLabel(horizon)}` : ''}. Undo removes it.`,
      badges: [{ label: 'Goals' }, { label: 'Reversible' }],
      ...(i.reason ? { summary: i.reason } : {}),
      contentHeading: { label: 'Draft', meta: 'Edit it before you approve' },
      content: [{ kind: 'message', id: 'goal', label: 'Goal', body: goalDraftText(i) }],
      fields: [
        { label: 'Horizon', value: horizon ? horizonLabel(horizon) : i.horizon },
        { label: 'Measured by', value: measureText(i.measure) },
        ...(i.links?.length ? [{ label: 'Links', value: i.links.map(l => l.label ?? `${l.kind} ${l.id}`).join(', ') }] : []),
        { label: 'Weekly review', value: i.weekly_review ? 'Yes, in your Friday review' : 'No' },
      ],
      nextAction: 'Approving sets the goal: it lists under Goals, shows in your morning brief, and the assistant keeps it moving. Undo removes it.',
      verbs: { approve: 'Set the goal', reject: 'Don\'t set it' },
    };
  },
  applyContentEdits(i, edits) {
    const edit = edits.find(e => e.id === 'goal');
    return edit?.body === undefined ? i : applyGoalDraft(i, edit.body);
  },
  async execute(ctx, i) {
    const owner = await ownerOf(ctx);
    if (!owner) {
      throw new Error('No Vocion person behind this goal.');
    }
    const horizon = parseHorizon(i.horizon);
    if (!horizon) {
      throw new Error(`"${i.horizon}" is not a horizon.`);
    }
    const { createGoal } = await import('@/services/objectives/GoalService');
    const goal = await createGoal({
      orgId: ctx.orgId,
      ownerUserId: owner.userId,
      title: i.title,
      horizon,
      measure: storedMeasure(i.measure),
      links: (i.links ?? []) as GoalLink[],
      cadence: i.weekly_review ? 'weekly' : null,
      nextSteps: i.next_steps ?? [],
      createdBy: ctx.proposedBy?.startsWith('agent:') ? 'agent' : owner.userId,
      conversationId: ctx.origin?.conversationId ?? null,
    });
    return { goalId: goal.id, ownerUserId: owner.userId, href: `/dashboard/goals/${goal.id}`, line: `Set GOAL-${goal.id} “${goal.title}”, ${horizonLabel(horizon)}.` };
  },
  async undo(ctx, _i, result) {
    const goalId = typeof result?.goalId === 'number' ? result.goalId : null;
    const owner = typeof result?.ownerUserId === 'string' ? result.ownerUserId : null;
    if (!goalId || !owner) {
      throw new Error('This run recorded no goal, so there is nothing to undo.');
    }
    const [{ db }, { and, eq }, { goalSchema }] = await Promise.all([import('@/libs/DB'), import('drizzle-orm'), import('@/models/Schema')]);
    await db.delete(goalSchema).where(and(eq(goalSchema.orgId, ctx.orgId), eq(goalSchema.id, goalId), eq(goalSchema.ownerUserId, owner)));
    return { line: 'Removed the goal.' };
  },
};
