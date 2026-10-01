import type { RuntimeContext } from '../types';
import type { OnboardingStatus, OnboardingStep } from '@/services/OnboardingService';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { nextOnboardingStep, onboardingStatus } from '@/services/OnboardingService';

/**
 * One instruction per step. Each names exactly one path, because a model
 * follows every branch it is given (DESIGN-PRINCIPLES: one obvious path).
 */
const STEP_GUIDE: Record<OnboardingStep, string> = {
  describe: 'NEXT: ask what this workspace is for: which client or team, and the outcome it should help with. When they answer, save it with propose_action, action workspace.describe, input {"description": "<their words, tidied>"}.',
  connect: 'NEXT: call list_capabilities, pick the plugins whose "Helps when" fits the description, and call offer_connection once for each connector they "work best with" that is not connected. Offer at most three, the most useful first.',
  grow: 'NEXT: offer to turn on the plugins whose "Helps when" fits (recommend_action, action plugin.enable, input {"slug": "<slug>"}), call offer_connection for any connector they still need, then hand each enabled plugin\'s team lead the description with task and ask what it needs to start.',
};

/**
 * The status as the model reads it: what is done, then the next step.
 * @param status - From `onboardingStatus`.
 * @returns Plain text.
 */
export function renderSetupStatus(status: OnboardingStatus): string {
  return [
    status.done ? 'Setup is complete: the workspace is described and has a connected source. Keep growing it if the person wants.' : 'Setup is in progress.',
    `Description: ${status.description ?? '(none yet)'}`,
    `Connected: ${status.connectedConnectors.length ? status.connectedConnectors.join(', ') : '(nothing yet)'}`,
    `Plugins on: ${status.enabledPlugins.length ? status.enabledPlugins.join(', ') : '(none)'}`,
    STEP_GUIDE[nextOnboardingStep(status)],
  ].join('\n');
}

/**
 * Read the status for a workspace and render it, or say plainly that there is none.
 * @param orgId - The workspace.
 * @returns The tool's text result.
 */
async function describeWorkspaceSetup(orgId: string): Promise<string> {
  const status = await onboardingStatus(orgId);
  return status ? renderSetupStatus(status) : 'This workspace was not found, so there is no setup to report.';
}

/**
 * `workspace_setup` (#1028): where this workspace's setup stands and the one
 * next step. The procedure lives here, in code, not in a skill, because a
 * core skill cannot reach every workspace's own lead.
 * @param ctx - The turn's runtime context.
 * @returns The tool.
 */
export function workspaceSetupTool(ctx: RuntimeContext) {
  return tool(
    async () => describeWorkspaceSetup(ctx.orgId),
    {
      name: 'workspace_setup',
      description: 'Where this workspace\'s setup stands (description, connected tools, plugins) and the one next step. Use it when the person asks to onboard or set up this workspace, in the setup conversation, and after they say they connected something.',
      schema: z.object({}),
    },
  );
}
