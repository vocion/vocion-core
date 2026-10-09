/**
 * What the goal pages render, read on the server in one place: the Goals
 * list (a workspace's, or "Your goals" in Personal across the workspaces it
 * reaches) and one goal's page, measured live. Shapes in
 * `features/goals/types.ts`; the reads in `GoalService.ts`.
 */

import type { GoalDetail, GoalRow } from '@/features/goals/types';
import type { Goal } from '@/libs/objectives/goal';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { daysLeft, horizonLabel, linkKey, nextStepsFor, stalledFor } from '@/libs/objectives/goal';
import { projectSchema, userSchema } from '@/models/Schema';
import { getGoal, listGoals, measureGoal, personalGoals, resolveGoalLinks } from './GoalService';

/**
 * People's names by id.
 * @param ids - User ids.
 */
async function namesOf(ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) {
    return new Map();
  }
  const rows = await db.select({ id: userSchema.id, name: userSchema.name, email: userSchema.email }).from(userSchema).where(inArray(userSchema.id, wanted));
  return new Map(rows.map(r => [r.id, r.name?.trim() || r.email]));
}

/**
 * The last reading, said short enough for a row on a phone: "12 of 40",
 * "2 of 5", "not measured". The goal's page says the whole of it.
 * @param g - The goal.
 */
function lastReading(g: Goal): { label: string; ratio: number | null } {
  if (g.measure.kind === 'milestones') {
    const done = g.measure.milestones.filter(m => m.done).length;
    return { label: `${done} of ${g.measure.milestones.length}`, ratio: done / g.measure.milestones.length };
  }
  return g.lastTotal ? { label: `${g.lastDone ?? 0} of ${g.lastTotal}`, ratio: (g.lastDone ?? 0) / g.lastTotal } : { label: 'not measured', ratio: null };
}

/**
 * The Goals list for where the person is.
 * @param input - Who and where.
 * @param input.orgId - The workspace.
 * @param input.userId - The person.
 * @param input.now - The clock.
 */
export async function goalsListFor(input: { orgId: string; userId: string; now?: Date }): Promise<{ personal: boolean; rows: GoalRow[]; withheld: Array<{ accountName: string; workspace: string; count: number; link: string }> }> {
  const now = input.now ?? new Date();
  const [project] = await db.select({ kind: projectSchema.kind }).from(projectSchema).where(eq(projectSchema.id, input.orgId)).limit(1);
  if (project?.kind === 'personal') {
    const { goals, withheld } = await personalGoals(input.userId);
    const multiOrg = new Set(goals.map(g => g.workspace.accountName)).size > 1;
    return {
      personal: true,
      withheld,
      rows: goals.map(g => ({
        id: g.id,
        title: g.title,
        href: g.href,
        status: g.status,
        horizon: horizonLabel(g.horizon),
        ...(() => {
          const r = lastReading(g);
          return { progress: r.label, ratio: r.ratio };
        })(),
        owner: '',
        mine: true,
        place: g.workspace.personal ? 'Personal' : multiOrg && g.workspace.accountName ? `${g.workspace.name} · ${g.workspace.accountName}` : g.workspace.name,
        stalledDays: stalledFor(g, now),
      })),
    };
  }
  const goals = await listGoals({ orgId: input.orgId });
  const names = await namesOf(goals.map(g => g.ownerUserId));
  return {
    personal: false,
    withheld: [],
    rows: goals.map((g) => {
      const r = lastReading(g);
      return { id: g.id, title: g.title, href: `/dashboard/goals/${g.id}`, status: g.status, horizon: horizonLabel(g.horizon), progress: r.label, ratio: r.ratio, owner: names.get(g.ownerUserId) ?? 'Someone', mine: g.ownerUserId === input.userId, stalledDays: stalledFor(g, now) };
    }),
  };
}

/**
 * One goal's page, measured now. Null when it is not in this workspace.
 * @param input - Which, for whom.
 * @param input.orgId - The workspace.
 * @param input.userId - The person looking.
 * @param input.goalId - The goal.
 * @param input.now - The clock.
 */
export async function goalDetailFor(input: { orgId: string; userId: string; goalId: number; now?: Date }): Promise<GoalDetail | null> {
  const now = input.now ?? new Date();
  const found = await getGoal(input.orgId, input.goalId);
  if (!found) {
    return null;
  }
  const { goal, progress, viewName } = await measureGoal(found, { now });
  const milestoneLinks = goal.measure.kind === 'milestones' ? goal.measure.milestones.flatMap(m => (m.link ? [m.link] : [])) : [];
  const viewLink = goal.measure.kind === 'view' ? [{ kind: 'view' as const, id: goal.measure.view }] : [];
  const [resolved, names, [project]] = await Promise.all([
    resolveGoalLinks(goal.orgId, goal.ownerUserId, [...goal.links, ...milestoneLinks, ...viewLink]),
    namesOf([goal.ownerUserId]),
    db.select({ name: projectSchema.name, kind: projectSchema.kind }).from(projectSchema).where(eq(projectSchema.id, goal.orgId)).limit(1),
  ]);
  const byKey = new Map(resolved.map(l => [linkKey(l), l]));
  const owner = goal.ownerUserId === input.userId;
  return {
    id: goal.id,
    title: goal.title,
    status: goal.status,
    horizon: horizonLabel(goal.horizon),
    daysLeft: daysLeft(goal.horizon, now),
    owner: owner ? 'You' : names.get(goal.ownerUserId) ?? 'Someone',
    isOwner: owner,
    workspace: project?.kind === 'personal' ? 'Personal' : project?.name ?? '',
    weeklyReview: goal.cadence === 'weekly',
    progress: { label: progress.label, ratio: progress.ratio, ...(progress.unmeasured ? { unmeasured: progress.unmeasured } : {}) },
    measure: goal.measure.kind === 'view'
      ? { kind: 'view', viewName: viewName ?? goal.measure.view, href: byKey.get(`view:${goal.measure.view}`)?.href ?? null }
      : { kind: 'milestones' },
    milestones: goal.measure.kind === 'milestones'
      ? goal.measure.milestones.map((m) => {
          const l = m.link ? byKey.get(linkKey(m.link)) : null;
          return { key: m.key, label: m.label, done: m.done, ...(m.doneAt ? { doneAt: m.doneAt } : {}), by: m.by ? (m.by === 'agent' ? 'agent' as const : 'person' as const) : null, ...(m.evidence ? { evidence: m.evidence } : {}), locked: Boolean(m.locked), link: l ? { title: l.title, href: l.href } : null };
        })
      : [],
    links: goal.links.map(l => byKey.get(linkKey(l))).filter((l): l is NonNullable<typeof l> => !!l).map(l => ({ kind: l.kind, id: l.id, title: l.label ?? l.title, href: l.href })),
    nextSteps: nextStepsFor(goal, progress, viewName ?? undefined),
    activity: [...goal.activity].reverse(),
    stalledDays: stalledFor(goal, now),
  };
}
