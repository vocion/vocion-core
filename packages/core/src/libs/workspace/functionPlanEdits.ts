/**
 * The edits a person makes to a drafted plan on its preview: rename a team,
 * an agent, a mission or an automation, or remove one. Pure and client-safe
 * (types only), so the preview edits in the browser and the server validates
 * the result again on Create (`checkedPlan`).
 *
 * Removing keeps the plan whole: a team takes its agents with it, an agent its
 * missions and automations, a mission the automations that keep it. A team's
 * lead cannot be removed on its own — remove the team, or keep the lead.
 */

import type { FunctionPlan } from './functionPlan';

export type PlanItemKind = 'team' | 'agent' | 'mission' | 'automation';

/**
 * Rename one item. Its slug stays — names are for people, slugs for the files.
 * @param plan - The plan.
 * @param kind - What is renamed.
 * @param slug - Which one.
 * @param name - Its new name.
 */
export function renameInPlan(plan: FunctionPlan, kind: PlanItemKind, slug: string, name: string): FunctionPlan {
  const rename = <T extends { slug: string; name: string }>(items: T[]): T[] => items.map(i => (i.slug === slug ? { ...i, name } : i));
  switch (kind) {
    case 'team': return { ...plan, teams: rename(plan.teams) };
    case 'agent': return { ...plan, agents: rename(plan.agents) };
    case 'mission': return { ...plan, missions: rename(plan.missions) };
    case 'automation': return { ...plan, automations: rename(plan.automations) };
  }
}

/**
 * Why this item cannot be removed on its own, or null when it can.
 * @param plan - The plan.
 * @param kind - What would be removed.
 * @param slug - Which one.
 */
export function cannotRemove(plan: FunctionPlan, kind: PlanItemKind, slug: string): string | null {
  if (kind === 'team' && plan.teams.length <= 1) {
    return 'a plan needs at least one team';
  }
  if (kind === 'agent') {
    const leads = plan.teams.find(t => t.lead === slug);
    if (leads) {
      return `leads ${leads.name} — remove the team, or keep its lead`;
    }
  }
  if (kind === 'mission' && plan.missions.length <= 1) {
    return 'a plan needs at least one mission';
  }
  return null;
}

/**
 * Remove one item and everything that only existed for it. An item that
 * cannot be removed on its own (`cannotRemove`) leaves the plan as it was.
 * @param plan - The plan.
 * @param kind - What is removed.
 * @param slug - Which one.
 */
export function removeFromPlan(plan: FunctionPlan, kind: PlanItemKind, slug: string): FunctionPlan {
  if (cannotRemove(plan, kind, slug)) {
    return plan;
  }
  if (kind === 'automation') {
    return { ...plan, automations: plan.automations.filter(a => a.slug !== slug) };
  }
  if (kind === 'mission') {
    return {
      ...plan,
      missions: plan.missions.filter(m => m.slug !== slug),
      automations: plan.automations.filter(a => a.checkMission !== slug),
    };
  }
  const agents = kind === 'team' ? plan.agents.filter(a => a.team === slug).map(a => a.slug) : [slug];
  const missions = plan.missions.filter(m => agents.includes(m.agent)).map(m => m.slug);
  const kept = {
    ...plan,
    teams: kind === 'team' ? plan.teams.filter(t => t.slug !== slug) : plan.teams,
    agents: plan.agents.filter(a => !agents.includes(a.slug)),
    missions: plan.missions.filter(m => !missions.includes(m.slug)),
    automations: plan.automations.filter(a => !agents.includes(a.agent) && !(a.checkMission && missions.includes(a.checkMission))),
  };
  // The plan keeps a mission even when the last one's agent went: the person is told on Create.
  return kept;
}

/**
 * What would stop this plan being created, said before Create is pressed —
 * the shape the server checks again, reduced to what an edit can break.
 * @param plan - The plan as edited.
 */
export function planBlockers(plan: FunctionPlan): string[] {
  return [
    plan.teams.length === 0 ? 'Keep at least one team.' : null,
    plan.missions.length === 0 ? 'Keep at least one mission — a function with none has nothing it owes.' : null,
    plan.agents.length === 0 ? 'Keep at least one agent.' : null,
  ].filter((b): b is string => b !== null);
}
