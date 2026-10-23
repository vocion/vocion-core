/**
 * Goals, for agents — the person's own outcomes past one conversation
 * (`libs/objectives/goal.ts`, `services/objectives/GoalService.ts`).
 *
 * - goal_create drafts a goal as a Decision card (`goal.create`): the person
 *   approves it, edits it, or declines. Never a goal made silently.
 * - goal_update changes its title, horizon, status, weekly review, next steps,
 *   milestones or a sprint's weekly targets; goal_link links (or unlinks)
 *   the work that serves it.
 * - goal_progress reads it live (counted from its view, its milestones read
 *   against their linked work, or a sprint's scorecard), marks a milestone
 *   done with evidence, and logs a sprint's week: one number per target, each
 *   with what it was counted from. A view goal is never ticked by hand, and a
 *   number the person wrote is never moved.
 * - goal_list lists the person's goals: here, or from a Personal, across the
 *   workspaces it reaches.
 *
 * Every tool is the person's: it needs a person in the turn and moves only
 * goals they own, in this workspace. The services load when a tool runs, not
 * when it is listed (the route graph, `scripts/check-route-graph.ts`).
 */
import type { RuntimeContext } from '../types';
import type { Goal, GoalLink } from '@/libs/objectives/goal';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { GOAL_LINK_KINDS, GOAL_STATUSES, goalLine, horizonLabel, localDay, MAX_MILESTONES, MAX_SPRINT_TARGETS, MIN_MILESTONES, MIN_SPRINT_TARGETS, nextStepsFor, parseHorizon, sprintWeeks, targetLine, weekOf } from '@/libs/objectives/goal';

const goalRef = z.union([z.number().int().positive(), z.string().min(1)]).describe('The goal: its code (GOAL-12) or id.');
const linkSchema = z.object({ kind: z.enum(GOAL_LINK_KINDS), id: z.string().min(1).describe('Row id (records, rooms, artifacts, conversations), a view\'s slug, or a wiki page as <page>/<slug>.'), label: z.string().optional() });

/**
 * A goal id from a code or a number.
 * @param ref - What the model passed.
 */
export function goalIdOf(ref: number | string): number | null {
  if (typeof ref === 'number') {
    return ref;
  }
  const m = /^(?:GOAL-)?(\d+)$/i.exec(ref.trim());
  return m ? Number(m[1]) : null;
}

/**
 * One goal as the model reads it.
 * @param goal - The goal.
 * @param progress - Where it stands.
 * @param progress.done
 * @param progress.total
 * @param progress.ratio
 * @param progress.label - Said as.
 * @param progress.unmeasured - Why it could not be counted.
 * @param viewName - Its view's name.
 * @param today
 */
export function renderGoal(goal: Goal, progress: { done: number; total: number; ratio: number | null; label: string; unmeasured?: string }, viewName: string | null, today: string = localDay(new Date())): string {
  const out = [`GOAL-${goal.id} ${goalLine(goal, progress)}`];
  if (progress.unmeasured) {
    out.push(`  Not measured: ${progress.unmeasured}`);
  }
  if (goal.measure.kind === 'sprint') {
    const sprint = goal.measure;
    const all = sprintWeeks(sprint.starts, goal.horizon);
    const shown = all.filter(w => w <= weekOf(today)).slice(-4);
    out.push(`  Sprint ${sprint.starts} to ${all.at(-1)}, ${all.length} weeks. Scorecard, last ${shown.length} week${shown.length === 1 ? '' : 's'} (${shown.join(', ') || 'none started'}):`);
    for (const t of sprint.targets) {
      const cells = shown.map((w) => {
        const v = sprint.weeks.find(x => x.week === w)?.values[t.key];
        return v ? `${v.value}${v.value >= t.perWeek ? ' met' : ' missed'}${v.locked ? ' (the person\'s)' : ''}` : 'not logged';
      });
      out.push(`  ${t.key} ${targetLine(t)}: ${cells.join(' | ')}`);
    }
    const notes = sprint.weeks.filter(w => w.note && shown.includes(w.week)).map(w => `${w.week}: ${w.note}`);
    if (notes.length > 0) {
      out.push(`  Notes: ${notes.join('; ')}`);
    }
  } else if (goal.measure.kind === 'view') {
    out.push(`  Measured by view "${viewName ?? goal.measure.view}"${goal.measure.done ? ` (done when ${JSON.stringify(goal.measure.done)})` : ''}${goal.measure.target ? `, target ${goal.measure.target}` : ''} — counted live, never ticked.`);
  } else {
    for (const m of goal.measure.milestones) {
      out.push(`  [${m.done ? 'x' : ' '}] ${m.key} ${m.label}${m.link ? ` (linked ${m.link.kind} ${m.link.id})` : ''}${m.locked ? ' — set by the person' : ''}`);
    }
  }
  if (goal.links.length > 0) {
    out.push(`  Linked: ${goal.links.map(l => `${l.kind} ${l.id}${l.label ? ` “${l.label}”` : ''}`).join('; ')}`);
  }
  const steps = nextStepsFor(goal, { ...progress, ratio: progress.ratio }, viewName ?? undefined, today);
  if (steps.length > 0) {
    out.push(`  Next steps: ${steps.map(s => s.label).join(' | ')}`);
  }
  const recent = goal.activity.slice(-3).map(a => `${a.at.slice(0, 10)} ${a.what}`);
  if (recent.length > 0) {
    out.push(`  Recently: ${recent.join('; ')}`);
  }
  return out.join('\n');
}

/**
 * The goal tools. Present whenever a person is in the turn.
 * @param ctx - The turn.
 */
export function goalTools(ctx: RuntimeContext) {
  if (!ctx.userId) {
    return [];
  }
  const userId = ctx.userId;
  const actor = { userId, by: 'agent' as const };
  const fail = (error: unknown) => (error instanceof Error ? `Not done: ${error.message}` : 'Not done: the goal could not be changed.');

  const create = tool(
    async (args) => {
      const [{ goalCreateAction, GOAL_CREATE_ACTION_ID }, { viewsFor }] = await Promise.all([import('@/libs/actions/goal-create'), import('@/services/state/state')]);
      const input = {
        title: args.title,
        horizon: args.horizon,
        measure: args.measure,
        ...(args.links?.length ? { links: args.links } : {}),
        ...(args.weekly_review !== undefined ? { weekly_review: args.weekly_review } : {}),
        ...(args.next_steps?.length ? { next_steps: args.next_steps } : {}),
        ...(args.reason ? { reason: args.reason } : {}),
      };
      const parsed = goalCreateAction.inputSchema.safeParse(input);
      if (!parsed.success) {
        return `Draft not shown — ${parsed.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}. Fix those and call again.`;
      }
      const problem = await goalCreateAction.precheck!({ orgId: ctx.orgId, invokedBy: userId, origin: { userId } } as never, parsed.data);
      if (problem) {
        const views = args.measure.kind === 'view' ? (await viewsFor({ orgId: ctx.orgId, userId })).map(v => `${v.slug} (${v.name})`).join(', ') : '';
        return `Draft not shown — ${problem}${views ? ` Views here: ${views}.` : ''}`;
      }
      const label = `Set the goal: ${parsed.data.title}`;
      ctx.emit({
        type: 'recommended_action',
        recommendation: {
          actionId: GOAL_CREATE_ACTION_ID,
          input: parsed.data,
          label,
          rationale: parsed.data.reason ?? 'An outcome you named, kept as a goal with a measure.',
          confidence: 0.85,
          agentSlug: ctx.agentSlug,
          suggestedDecision: 'approve',
          suggestedDecisionReason: 'You asked for it, or named it as something you want done; the measure is my proposal, so it is worth one look.',
        },
      });
      return `Put the draft goal "${parsed.data.title}" in front of the person as a decision: they approve it, edit it on the card, or decline. Your turn ends there; do not paste the draft as text.`;
    },
    {
      name: 'goal_create',
      description: [
        'Draft one of the person\'s GOALS — an outcome they own past this conversation ("follow up with every Northwind Expo contact by Nov 30", "activate the referral partners in Q4") — as a Decision card they approve or edit. Never sets it silently.',
        'Use it when the person says "make this a goal", or states an open-ended aim with no end in this conversation (offer it once; do not push).',
        `Measure: a saved VIEW that fits (call query_state with list: true first), with the facets that mark a row done ({"reply_state": "replied"}) or a target count — counted live, never ticked; or ${MIN_MILESTONES}–${MAX_MILESTONES} MILESTONES you propose, each optionally linked to the work that completes it.`,
        `Or a SPRINT: a start date, the horizon as its end, and ${MIN_SPRINT_TARGETS}–${MAX_SPRINT_TARGETS} weekly targets ("Discovery calls", 3 a week) — for a plan with a weekly scorecard; each week is logged with goal_progress.`,
        'Suggest links to what serves it: data rooms, wiki pages, artifacts, saved views, conversations, records.',
      ].join(' '),
      schema: z.object({
        title: z.string().describe('The outcome in the person\'s words.'),
        horizon: z.string().describe('A due date (2026-11-30) or a quarter (2026-Q4).'),
        measure: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('view'), view: z.string().describe('A saved view\'s slug.'), done: z.record(z.string(), z.unknown()).optional().describe('Facets that make a row count as done.'), target: z.number().int().positive().optional(), unit: z.string().optional().describe('What a done row is called: "contacted".') }),
          z.object({ kind: z.literal('milestones'), milestones: z.array(z.object({ label: z.string(), link: linkSchema.optional() })).describe(`${MIN_MILESTONES} to ${MAX_MILESTONES} steps.`) }),
          z.object({
            kind: z.literal('sprint'),
            starts: z.string().describe('The first day, 2026-10-26. The horizon is the last.'),
            targets: z.array(z.object({ label: z.string(), per_week: z.number().int().positive(), unit: z.string().optional() })).describe(`${MIN_SPRINT_TARGETS} to ${MAX_SPRINT_TARGETS} weekly targets.`),
          }),
        ]),
        links: z.array(linkSchema).optional(),
        weekly_review: z.boolean().optional().describe('Read it in the person\'s Friday review.'),
        next_steps: z.array(z.object({ label: z.string(), prompt: z.string() })).max(3).optional().describe('Up to three first moves, each a prompt the person could send.'),
        reason: z.string().optional().describe('One line: why this is worth keeping as a goal.'),
      }),
    },
  );

  const update = tool(
    async (args) => {
      const id = goalIdOf(args.goal);
      if (!id) {
        return `"${String(args.goal)}" is not a goal code.`;
      }
      const horizon = args.horizon ? parseHorizon(args.horizon) : undefined;
      if (args.horizon && !horizon) {
        return `"${args.horizon}" is not a horizon: a date (2026-11-30) or a quarter (2026-Q4).`;
      }
      const { updateGoal } = await import('@/services/objectives/GoalService');
      try {
        const goal = await updateGoal(ctx.orgId, id, actor, {
          ...(args.title ? { title: args.title } : {}),
          ...(horizon ? { horizon } : {}),
          ...(args.status ? { status: args.status } : {}),
          ...(args.weekly_review !== undefined ? { cadence: args.weekly_review ? 'weekly' as const : null } : {}),
          ...(args.next_steps ? { nextSteps: args.next_steps } : {}),
          ...(args.milestones ? { milestones: args.milestones as Array<{ label: string; link?: GoalLink }> } : {}),
          ...(args.targets ? { targets: args.targets.map(t => ({ label: t.label, perWeek: t.per_week, ...(t.unit ? { unit: t.unit } : {}) })) } : {}),
        });
        return `Updated GOAL-${goal.id} “${goal.title}” — ${goal.status}, ${horizonLabel(goal.horizon)}. ${goal.activity.at(-1)?.what ?? ''}`.trim();
      } catch (error) {
        return fail(error);
      }
    },
    {
      name: 'goal_update',
      description: 'Change one of the person\'s goals on their word: title, horizon, status (active / paused / done / dropped), weekly review, the next steps you propose (up to three prompts), re-plan its milestones, or re-plan a sprint\'s weekly targets (a target whose label is kept keeps its logged weeks). A view goal\'s progress is not a field — it is counted; a sprint\'s week is logged with goal_progress.',
      schema: z.object({
        goal: goalRef,
        title: z.string().optional(),
        horizon: z.string().optional().describe('A date (2026-11-30) or a quarter (2026-Q4).'),
        status: z.enum(GOAL_STATUSES).optional(),
        weekly_review: z.boolean().optional(),
        next_steps: z.array(z.object({ label: z.string(), prompt: z.string(), why: z.string().optional() })).max(3).optional(),
        milestones: z.array(z.object({ label: z.string(), link: linkSchema.optional() })).min(MIN_MILESTONES).max(MAX_MILESTONES).optional(),
        targets: z.array(z.object({ label: z.string(), per_week: z.number().int().positive(), unit: z.string().optional() })).min(MIN_SPRINT_TARGETS).max(MAX_SPRINT_TARGETS).optional().describe('A sprint\'s weekly targets, re-planned.'),
      }),
    },
  );

  const link = tool(
    async (args) => {
      const id = goalIdOf(args.goal);
      if (!id) {
        return `"${String(args.goal)}" is not a goal code.`;
      }
      const { linkGoal } = await import('@/services/objectives/GoalService');
      try {
        const goal = await linkGoal(ctx.orgId, id, actor, { add: args.add as GoalLink[] | undefined, remove: args.remove as GoalLink[] | undefined });
        return `GOAL-${goal.id} now links ${goal.links.length === 0 ? 'nothing' : goal.links.map(l => `${l.kind} “${l.label ?? l.id}”`).join(', ')}.`;
      } catch (error) {
        return fail(error);
      }
    },
    {
      name: 'goal_link',
      description: 'Link work that serves one of the person\'s goals — a data room, wiki page, artifact, saved view, conversation or record in this workspace — or unlink it. Each must be something here they can open.',
      schema: z.object({ goal: goalRef, add: z.array(linkSchema).optional(), remove: z.array(linkSchema).optional() }),
    },
  );

  const progress = tool(
    async (args) => {
      const id = goalIdOf(args.goal);
      if (!id) {
        return `"${String(args.goal)}" is not a goal code.`;
      }
      const { getGoal, logGoalSprintWeek, measureGoal, setGoalMilestone } = await import('@/services/objectives/GoalService');
      const today = localDay(new Date(), ctx.timeZone ?? ctx.defaultTimeZone);
      try {
        if (args.milestone) {
          await setGoalMilestone(ctx.orgId, id, actor, args.milestone, args.done ?? true, args.evidence);
        }
        let refused: string[] = [];
        if (args.values?.length || args.note !== undefined) {
          ({ refused } = await logGoalSprintWeek(ctx.orgId, id, actor, { ...(args.week ? { week: args.week } : {}), entries: (args.values ?? []).map(v => ({ target: v.target, value: v.value, evidence: v.evidence })), ...(args.note !== undefined ? { note: args.note } : {}), today }));
        }
        const goal = await getGoal(ctx.orgId, id);
        if (!goal) {
          return `No GOAL-${id} in this workspace.`;
        }
        const measured = await measureGoal(goal, { today });
        const said = renderGoal(measured.goal, measured.progress, measured.viewName, today);
        return refused.length > 0 ? `${said}\nNot logged: ${refused.join(' ')}` : said;
      } catch (error) {
        return fail(error);
      }
    },
    {
      name: 'goal_progress',
      description: [
        'Read where one of the person\'s goals stands now — counted live from its view, its milestones read against their linked work, or a sprint\'s scorecard — with its links, next steps and what moved lately.',
        'Pass a milestone (and evidence) to mark it done when you can show the work is finished; never on a view goal, and never over a milestone the person set themselves.',
        'On a SPRINT, pass values to log a week: one number per weekly target, each with the evidence it was counted from (the records, the view, the messages). One number per target per week — logging again replaces yours. A number the person wrote is theirs and is never moved; ask them for what you cannot count rather than guess.',
      ].join(' '),
      schema: z.object({
        goal: goalRef,
        milestone: z.string().optional().describe('A milestone key (m2) to mark.'),
        done: z.boolean().optional().describe('Done (default) or reopened.'),
        evidence: z.string().optional().describe('What shows it is done: the record, artifact or message, by its code.'),
        week: z.string().optional().describe('A sprint: any day of the week to log (2026-11-02). Default this week.'),
        values: z.array(z.object({
          target: z.string().describe('The weekly target, by key (t2) or label.'),
          value: z.number().min(0).describe('What the week holds.'),
          evidence: z.string().describe('What it was counted from.'),
        })).optional().describe('A sprint: the week\'s numbers.'),
        note: z.string().optional().describe('A sprint: one line on the week — what worked, what did not.'),
      }),
    },
  );

  const list = tool(
    async (args) => {
      const statuses = args.status === 'all' ? undefined : [args.status ?? 'active'] as const;
      const svc = await import('@/services/objectives/GoalService');
      if (ctx.workspaceKind === 'personal') {
        const { goals, withheld } = await svc.personalGoals(userId, { ...(statuses ? { statuses } : {}) });
        const lines = goals.map(g => `- GOAL-${g.id} ${g.title} · ${g.lastTotal !== null ? `${g.lastDone ?? 0} of ${g.lastTotal}` : 'not measured yet'} · ${horizonLabel(g.horizon)} · ${g.status} · ${g.workspace.personal ? 'Personal' : `${g.workspace.name}${g.workspace.accountName ? ` · ${g.workspace.accountName}` : ''}`}`);
        const held = withheld.map(w => `- ${w.accountName} › ${w.workspace}: ${w.count} goal${w.count === 1 ? '' : 's'} (that Org keeps its items out of Personal — say the number and the link, never guess what they are: ${w.link})`);
        return [...lines, ...held].join('\n') || 'No goals yet.';
      }
      const goals = await svc.listGoals({ orgId: ctx.orgId, ownerUserId: userId, ...(statuses ? { statuses } : {}) });
      return goals.map(g => `- GOAL-${g.id} ${g.title} · ${g.lastTotal !== null ? `${g.lastDone ?? 0} of ${g.lastTotal}` : 'not measured yet'} · ${horizonLabel(g.horizon)} · ${g.status}`).join('\n') || 'No goals here yet.';
    },
    {
      name: 'goal_list',
      description: 'List the person\'s goals — in this workspace, or from their Personal across every workspace it reaches, each labelled with its workspace and Org — with the last reading of each. goal_progress reads one live.',
      schema: z.object({ status: z.enum([...GOAL_STATUSES, 'all']).optional().describe('Default active.') }),
    },
  );

  return [create, update, link, progress, list];
}
