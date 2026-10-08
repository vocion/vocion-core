import { listPlugins } from '@/libs/workspace/plugins';
import { setupStateForOrg } from '@/services/plugins/setupState';
import { enabledPluginsForOrg } from '@/services/PluginService';

/**
 * A plugin's schedules wait for its setup.
 *
 * The software factory's two-hourly reply pass woke on a workspace whose
 * setup had not begun, found Jira unconnected and asked a person about it —
 * a card about a factory that did not exist yet (Jamie, 2026-10-07: "The
 * jira card shouldn't show until I start 'set up the software factory'").
 * A schedule is the plugin waking on its own to look around; while the
 * plugin's `setup:` steps are not all done there is nothing real for it to
 * look at, so the tick is held and the hold is written in the automation's
 * log. An event fire is a response to something that happened in the
 * workspace, and a person's Run now is their word: neither is held.
 */

/** Why a schedule tick was held: the plugin and the setup steps still to do. */
type SetupHold = {
  plugin: string;
  name: string;
  /** The labels of the steps not yet done, in the plugin's order. */
  undone: string[];
};

export class PluginSetupIncompleteError extends Error {
  constructor(public readonly hold: SetupHold, public readonly automationSlug: string) {
    super(`automation "${automationSlug}" waits for the setup of ${hold.name}: ${hold.undone.join(', ')}`);
    this.name = 'PluginSetupIncompleteError';
  }
}

/**
 * A schedule tick: the durable schedule names the automation itself. A replay or a person's run does not.
 * @param invokedBy
 * @param automationSlug
 */
export function isScheduleTick(invokedBy: string, automationSlug: string): boolean {
  return invokedBy === `automation:${automationSlug}`;
}

/**
 * The plugin an automation slug ships with, among the plugins this org has on.
 * Null when it is the workspace's own or its plugin is off.
 * @param automationSlug - The automation.
 * @param enabled - The org's enabled plugin slugs.
 */
export function pluginOfAutomation(automationSlug: string, enabled: readonly string[]): string | null {
  const owner = listPlugins().find(p => enabled.includes(p.manifest.slug) && p.contents.automations.includes(automationSlug));
  return owner?.manifest.slug ?? null;
}

/**
 * The hold on a schedule tick of this automation, or null when it may run:
 * the automation is not a plugin's, or its plugin declares no setup, or the
 * setup is complete.
 * @param orgId - The workspace.
 * @param automationSlug - The automation whose schedule ticked.
 */
export async function setupHoldFor(orgId: string, automationSlug: string): Promise<SetupHold | null> {
  const plugin = pluginOfAutomation(automationSlug, await enabledPluginsForOrg(orgId));
  if (!plugin) {
    return null;
  }
  const setup = (await setupStateForOrg(orgId)).find(s => s.plugin === plugin);
  if (!setup || setup.complete) {
    return null;
  }
  return { plugin, name: setup.name, undone: setup.steps.filter(s => !s.done).map(s => s.label) };
}
