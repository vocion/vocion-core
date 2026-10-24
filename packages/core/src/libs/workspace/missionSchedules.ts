import type { LoadedAutomation, LoadedMission } from './loader';
import { AutomationManifestSchema } from './schemas';

/** A manifest that still loads but is written the old way: workspace:check warns, never errors. */
export type Deprecation = { resource: string; slug: string; message: string };

/** The workspace these automations load into. */
export type WhenContext = {
  /** `version:` in workspace.yaml — 2 is the 8.0 format, 1 loads with warnings until 9.0. */
  manifestVersion: 1 | 2;
  /** `defaults.timezone`, the zone a schedule is read in unless it names one. */
  workspaceZone: string | null;
  /** The workspace folder: an automation whose file is outside it came from a plugin. */
  workspaceDir: string;
};

/**
 * WHEN LIVES IN AUTOMATIONS (ADR 0008). Resolves the loaded automations into
 * the form every downstream reader can trust:
 *
 * - **Every schedule names its zone.** `when.timezone` is set on each one: the
 *   zone it wrote; else the workspace's zone for a version-2 workspace and for
 *   any plugin's automation; else UTC — which is what a version-1 workspace's
 *   own schedules always meant, so nothing moves on the clock until its
 *   manifests are migrated (`npm run migrate:automations`).
 * - **A mission's `schedule:` is an automation.** In a version-2 workspace it
 *   is refused. In a version-1 workspace it loads as the automation
 *   `<mission>-check` (its cron, UTC) with a deprecation, and is dropped when
 *   an active automation already checks the mission on a schedule — the two
 *   fired every tick. A workspace's own mission cron that differs from a
 *   plugin's automation for the same mission replaces that automation's.
 * @param missions - The workspace's missions, composed.
 * @param authored - The automations the workspace and its plugins declare.
 * @param ctx - The workspace.
 */
export function resolveAutomations(
  missions: LoadedMission[],
  authored: LoadedAutomation[],
  ctx: WhenContext,
): { automations: LoadedAutomation[]; deprecations: Deprecation[] } {
  const deprecations: Deprecation[] = [];
  const own = (a: LoadedAutomation) => a.sourceFile.startsWith(ctx.workspaceDir);
  const zoneFor = (a: LoadedAutomation) => {
    const named = a.when.timezone;
    if (named === 'workspace' || (named === undefined && (ctx.manifestVersion === 2 || !own(a)))) {
      return ctx.workspaceZone ?? 'UTC';
    }
    return named ?? 'UTC';
  };
  const automations = authored.map(a => (a.when.schedule ? { ...a, when: { ...a.when, timezone: zoneFor(a) } } : a));
  if (ctx.manifestVersion === 1 && authored.some(a => a.when.schedule && own(a) && !a.when.timezone)) {
    deprecations.push({
      resource: 'workspace',
      slug: 'version',
      message: 'version: 1 — this workspace\'s schedules are read in UTC. Run `npm run migrate:automations -- <workspace>` to move to version 2, where they are read in defaults.timezone.',
    });
  }
  const taken = new Set(authored.map(a => a.slug));
  for (const mission of missions) {
    if (!mission.schedule) {
      continue;
    }
    if (ctx.manifestVersion === 2) {
      throw new Error(`mission "${mission.slug}" (${mission.sourceFile}): schedule: was removed in version 2 — a cadence is an automation (when: {schedule}, do: {checkMission: ${mission.slug}}). Run \`npm run migrate:automations\`.`);
    }
    const keeperAt = automations.findIndex(a => a.do.checkMission === mission.slug && a.when.schedule && a.status !== 'disabled');
    const keeper = keeperAt >= 0 ? automations[keeperAt]! : null;
    if (keeper && !own(keeper) && mission.origin !== 'core' && keeper.when.schedule !== mission.schedule) {
      // The workspace changed a plugin mission's cadence: its cron wins, on the plugin's automation.
      automations[keeperAt] = { ...keeper, when: { ...keeper.when, schedule: mission.schedule, timezone: 'UTC' } };
      deprecations.push({ resource: 'mission', slug: mission.slug, message: `schedule: "${mission.schedule}" now sets automation "${keeper.slug}" (UTC). Override that automation instead.` });
      continue;
    }
    if (keeper) {
      deprecations.push({
        resource: 'mission',
        slug: mission.slug,
        message: `schedule: "${mission.schedule}" is ignored — automation "${keeper.slug}" already checks this mission on a schedule, and both would run. Remove schedule: from the mission.`,
      });
      continue;
    }
    const slug = [`${mission.slug}-check`, `${mission.slug}-scheduled-check`].find(s => !taken.has(s));
    if (!slug) {
      deprecations.push({
        resource: 'mission',
        slug: mission.slug,
        message: `schedule: "${mission.schedule}" is not running — move it to an automation (when: {schedule}, do: {checkMission: ${mission.slug}}); the slugs it would take are in use.`,
      });
      continue;
    }
    taken.add(slug);
    const manifest = AutomationManifestSchema.parse({
      slug,
      name: `${mission.name} (scheduled check)`,
      description: `The cadence on the "${mission.name}" mission, run as an automation.`,
      status: mission.status === 'active' ? 'active' : 'disabled',
      agent: mission.agent,
      when: { schedule: mission.schedule, timezone: 'UTC' },
      do: { checkMission: mission.slug },
    });
    automations.push({ ...manifest, sourceFile: mission.sourceFile });
    deprecations.push({
      resource: 'mission',
      slug: mission.slug,
      message: `schedule: is deprecated — it runs as automation "${slug}" (same cron, UTC). Run \`npm run migrate:automations\` to write it as one.`,
    });
  }
  return { automations, deprecations };
}
