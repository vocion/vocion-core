import type { AutomationListRow } from './AutomationsList';
import { cronToText } from '@/features/dashboard/TriggerBadge';
import { pausedSince } from '@/libs/factory/delivery';
import { ageLabel } from '@/libs/timeAgo';

/** An automation row, as the page reads it. */
export type PlanAutomation = {
  slug: string;
  name: string;
  status: string | null;
  whenConfig: { schedule?: string; timezone?: string; event?: string | string[] };
  pausedAt: Date | null;
  pausedNote: string | null;
  /** Who installed it: `plugin:<slug>` or `workspace`. Null on a row applied before it was stamped. */
  source?: string | null;
  /** `listed` or `system` (plumbing, hidden unless asked for). */
  visibility?: string | null;
};

/** A plugin that is on, and the automations it ships — the fallback for a row with no stamped source. */
export type PlanPlugin = { slug: string; name: string; automations: readonly string[] };

/** An app, and the plugins (its features) it is made of, in rail order. */
export type PlanApp = { id: string; name: string; plugins: readonly string[] };

/** The key for automations no plugin ships: the workspace's own. */
export const WORKSPACE_GROUP = 'workspace';

/** One app a person can filter the register to, with how many rows it has. */
export type AppFilterOption = { key: string; label: string; count: number };

/** The register, filtered: the rows to draw and the filter's options. */
export type AutomationsView = {
  rows: AutomationListRow[];
  /** Every app with a listed row (system rows only when they are shown), in rail order, the workspace's own last. */
  apps: AppFilterOption[];
  /** The app filtered to, or `''` for All. */
  selected: string;
  /** System automations left out of this view (zero when they are shown). */
  systemHidden: number;
};

/**
 * What an automation reacts to, in words: its schedule, or the events it is on.
 * @param when - `automation.when_config`.
 * @param when.schedule - A cron.
 * @param when.timezone - The zone the cron is read in; UTC when absent.
 * @param when.event - The event, or events, it answers.
 */
export function triggerWords(when: { schedule?: string; timezone?: string; event?: string | string[] }): string {
  if (when.schedule) {
    return cronToText(when.schedule, when.timezone);
  }
  const events = (Array.isArray(when.event) ? when.event : when.event ? [when.event] : []).map(e => e.replace(/[._]+/g, ' ').trim());
  return events.length > 0 ? `On ${events.join(', ')}` : 'By hand';
}

/**
 * The plugin that installed an automation, or null for the workspace's own.
 * The stamped `source` decides; a row applied before it was stamped falls
 * back to the plugin whose folder ships that slug. Pure.
 * @param a - The automation.
 * @param plugins - The plugins that are on.
 */
export function pluginOf(a: Pick<PlanAutomation, 'slug' | 'source'>, plugins: readonly PlanPlugin[]): string | null {
  if (a.source?.startsWith('plugin:')) {
    return a.source.slice('plugin:'.length);
  }
  if (a.source === WORKSPACE_GROUP) {
    return null;
  }
  return plugins.find(p => p.automations.includes(a.slug))?.slug ?? null;
}

/**
 * The register's rows — one per automation in the workspace, whichever app
 * installed it — filtered by app, with system automations left out unless
 * asked for. Each row names its app; rows run in rail order, the workspace's
 * own last, by name within an app. Pure: the page and an app's panel read the
 * tables and hand everything in, so both draw the same rows (principle 6).
 * @param input - What was read.
 * @param input.automations - Every automation in the workspace.
 * @param input.plugins - The plugins that are on, in their order.
 * @param input.apps - The app catalogue, each with its plugins, in rail order.
 * @param input.owners - Each automation's owning seat, by name.
 * @param input.lastRuns - Each automation's newest fire.
 * @param input.pausers - Who paused each paused automation, by name.
 * @param input.now - The clock.
 * @param input.filter - Narrow to one app (its id, or `workspace`) or one plugin; `showSystem` keeps the plumbing in.
 * @param input.filter.app - An app id, or `workspace`; absent or empty is All.
 * @param input.filter.plugin - One plugin's automations (an app's panel).
 * @param input.filter.showSystem - Include `visibility: system` rows.
 */
export function planAutomations(input: {
  automations: readonly PlanAutomation[];
  plugins: readonly PlanPlugin[];
  apps?: readonly PlanApp[];
  owners: ReadonlyMap<string, string | null>;
  lastRuns: ReadonlyMap<string, { status: string; startedAt: Date | null }>;
  pausers: ReadonlyMap<string, string>;
  now: number;
  filter?: { app?: string; plugin?: string; showSystem?: boolean };
}): AutomationsView {
  const apps = input.apps ?? [];
  const pluginName = new Map(input.plugins.map(p => [p.slug, p.name]));
  // Rail order: each app's position, then the workspace's own last.
  const order = new Map<string, number>(apps.map((a, i) => [a.id, i]));
  const appOf = (plugin: string | null): { key: string; label: string } => {
    if (!plugin) {
      return { key: WORKSPACE_GROUP, label: 'This workspace' };
    }
    const app = apps.find(a => a.plugins.includes(plugin));
    return app ? { key: app.id, label: app.name } : { key: plugin, label: pluginName.get(plugin) ?? plugin };
  };

  const row = (a: PlanAutomation, plugin: string | null): AutomationListRow => {
    const last = input.lastRuns.get(a.slug) ?? null;
    const failed = last?.status === 'error';
    const at = last?.startedAt ? ageLabel(last.startedAt, input.now) : null;
    const paused = a.status === 'active' && a.pausedAt !== null;
    const app = appOf(plugin);
    return {
      slug: a.slug,
      name: a.name,
      app: app.label,
      appKey: app.key,
      system: a.visibility === 'system',
      trigger: triggerWords(a.whenConfig ?? {}),
      owner: input.owners.get(a.slug) ?? null,
      last: !last ? 'Never ran' : last.status === 'running' ? `Running since ${at ?? 'now'}` : `${failed ? 'Failed' : 'Ran'} ${at ?? ''}`.trim(),
      lastFailed: failed,
      state: a.status !== 'active' ? 'off' : paused ? 'paused' : 'on',
      pause: paused ? { byName: input.pausers.get(a.slug) ?? 'someone', when: pausedSince(a.pausedAt!.toISOString()), note: a.pausedNote } : null,
    };
  };

  const showSystem = input.filter?.showSystem === true;
  const all = input.automations
    .map(a => ({ plugin: pluginOf(a, input.plugins), a }))
    .filter(({ plugin }) => !input.filter?.plugin || plugin === input.filter.plugin)
    .map(({ plugin, a }) => row(a, plugin));
  const shown = all.filter(r => showSystem || !r.system);
  const rank = (key: string) => (key === WORKSPACE_GROUP ? Number.MAX_SAFE_INTEGER : order.get(key) ?? apps.length);
  shown.sort((x, y) => rank(x.appKey) - rank(y.appKey) || x.app.localeCompare(y.app) || x.name.localeCompare(y.name));

  const counts = new Map<string, AppFilterOption>();
  for (const r of shown) {
    const option = counts.get(r.appKey) ?? { key: r.appKey, label: r.app, count: 0 };
    option.count += 1;
    counts.set(r.appKey, option);
  }
  const selected = input.filter?.app ?? '';
  return {
    rows: selected ? shown.filter(r => r.appKey === selected) : shown,
    apps: [...counts.values()],
    selected,
    systemHidden: all.length - shown.length,
  };
}
