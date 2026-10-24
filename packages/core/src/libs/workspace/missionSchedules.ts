import type { LoadedAutomation, LoadedMission } from './loader';
import { AutomationManifestSchema } from './schemas';

/** A manifest that still loads but is written the old way: workspace:check warns, never errors. */
export type Deprecation = { resource: string; slug: string; message: string };

/**
 * A MISSION'S `schedule:` BECOMES AN AUTOMATION (ADR 0008). Automations are the
 * one place time lives: a schedule fire there is logged, skipped while its last
 * fire is still running or while everything it has left waits on asks, held by
 * a pause, retried once on a provider hiccup and shown with its next run. A
 * mission's own cron had none of that: it ran `mission.check` straight from
 * the durable engine, with no row, no overlap guard and nothing on the
 * Automations page.
 *
 * So the loader turns each `schedule:` into the automation a person would
 * have written — same cron, read in UTC exactly as before, so nothing moves
 * on the clock — and says so as a deprecation. When the workspace already
 * checks the mission from an automation on a schedule, the mission's own
 * cron was a second, unguarded fire of the same check: it is dropped, and
 * the deprecation names the automation that keeps the cadence.
 * @param missions - The workspace's missions, composed.
 * @param authored - The automations the workspace and its plugins declare.
 */
export function scheduledChecksFromMissions(
  missions: LoadedMission[],
  authored: LoadedAutomation[],
): { automations: LoadedAutomation[]; deprecations: Deprecation[] } {
  const automations = [...authored];
  const deprecations: Deprecation[] = [];
  const taken = new Set(authored.map(a => a.slug));
  for (const mission of missions) {
    if (!mission.schedule) {
      continue;
    }
    const keeper = authored.find(a => a.do.checkMission === mission.slug && a.when.schedule && a.status !== 'disabled');
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
      when: { schedule: mission.schedule },
      do: { checkMission: mission.slug },
    });
    automations.push({ ...manifest, sourceFile: mission.sourceFile });
    deprecations.push({
      resource: 'mission',
      slug: mission.slug,
      message: `schedule: is deprecated — it now runs as automation "${slug}" (same cron, UTC). Move it to automations/${slug}.yaml, and add when.timezone to keep it on local time.`,
    });
  }
  return { automations, deprecations };
}
