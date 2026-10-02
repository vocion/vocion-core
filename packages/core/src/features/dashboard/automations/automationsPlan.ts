import type { AutomationListGroup, AutomationListRow } from './AutomationsList';
import { cronToText } from '@/features/dashboard/TriggerBadge';
import { pausedSince } from '@/libs/factory/delivery';
import { ageLabel } from '@/libs/timeAgo';

/** An automation row, as the page reads it. */
export type PlanAutomation = {
  slug: string;
  name: string;
  status: string | null;
  whenConfig: { schedule?: string; event?: string | string[] };
  pausedAt: Date | null;
  pausedNote: string | null;
};

/** A plugin that is on, and the automations it ships. */
export type PlanPlugin = { slug: string; name: string; automations: readonly string[] };

/** The group for automations no plugin ships: the workspace's own. */
export const WORKSPACE_GROUP = 'workspace';

/**
 * What an automation reacts to, in words: its schedule, or the events it is on.
 * @param when - `automation.when_config`.
 * @param when.schedule - A cron.
 * @param when.event - The event, or events, it answers.
 */
export function triggerWords(when: { schedule?: string; event?: string | string[] }): string {
  if (when.schedule) {
    return cronToText(when.schedule);
  }
  const events = (Array.isArray(when.event) ? when.event : when.event ? [when.event] : []).map(e => e.replace(/[._]+/g, ' ').trim());
  return events.length > 0 ? `On ${events.join(', ')}` : 'By hand';
}

/**
 * The page's rows, grouped by the plugin that ships each automation, the
 * workspace's own last; each group sorted by name. Pure: the page reads the
 * tables and hands everything in.
 * @param input - What the page read.
 * @param input.automations - Every automation in the workspace.
 * @param input.plugins - The plugins that are on, in their order.
 * @param input.owners - Each automation's owning seat, by name.
 * @param input.lastRuns - Each automation's newest fire.
 * @param input.pausers - Who paused each paused automation, by name.
 * @param input.now - The clock.
 */
export function planAutomations(input: {
  automations: readonly PlanAutomation[];
  plugins: readonly PlanPlugin[];
  owners: ReadonlyMap<string, string | null>;
  lastRuns: ReadonlyMap<string, { status: string; startedAt: Date | null }>;
  pausers: ReadonlyMap<string, string>;
  now: number;
}): AutomationListGroup[] {
  const groupOf = new Map<string, string>();
  for (const p of input.plugins) {
    for (const slug of p.automations) {
      if (!groupOf.has(slug)) {
        groupOf.set(slug, p.slug);
      }
    }
  }
  const row = (a: PlanAutomation): AutomationListRow => {
    const last = input.lastRuns.get(a.slug) ?? null;
    const failed = last?.status === 'error';
    const at = last?.startedAt ? ageLabel(last.startedAt, input.now) : null;
    const paused = a.status === 'active' && a.pausedAt !== null;
    return {
      slug: a.slug,
      name: a.name,
      trigger: triggerWords(a.whenConfig ?? {}),
      owner: input.owners.get(a.slug) ?? null,
      last: !last ? 'Never ran' : last.status === 'running' ? `Running since ${at ?? 'now'}` : `${failed ? 'Failed' : 'Ran'} ${at ?? ''}`.trim(),
      lastFailed: failed,
      state: a.status !== 'active' ? 'off' : paused ? 'paused' : 'on',
      pause: paused ? { byName: input.pausers.get(a.slug) ?? 'someone', when: pausedSince(a.pausedAt!.toISOString()), note: a.pausedNote } : null,
    };
  };
  const groups: AutomationListGroup[] = [
    ...input.plugins.map(p => ({ key: p.slug, label: p.name, rows: [] as AutomationListRow[] })),
    { key: WORKSPACE_GROUP, label: 'This workspace', rows: [] },
  ];
  const byKey = new Map(groups.map(g => [g.key, g]));
  for (const a of input.automations) {
    byKey.get(groupOf.get(a.slug) ?? WORKSPACE_GROUP)!.rows.push(row(a));
  }
  for (const g of groups) {
    g.rows.sort((x, y) => x.name.localeCompare(y.name));
  }
  return groups.filter(g => g.rows.length > 0);
}
