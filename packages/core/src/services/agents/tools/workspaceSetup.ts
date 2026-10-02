import type { RuntimeContext } from '../types';
import type { OnboardingStatus, OnboardingStep } from '@/services/OnboardingService';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { nextOnboardingStep, onboardingStatus } from '@/services/OnboardingService';

/**
 * How every setup question is asked, printed on every status. Verbatim from
 * the interview design (#1028): one card per turn, built from real data.
 */
export const HOW_TO_ASK = 'Ask every setup question with ask_choice: one per turn, options built from what you know, broad first and narrower with each answer. After a connector connects, call browse_connection and turn what it returns into the next ask_choice; bind source.connect to the options so the pick saves the source. When something doesn\'t line up — a missing status, a noisy list, a failed login — say what you found in one sentence and offer the ways forward as the options. Never ask for a password or token in chat: offer the connection instead.';

/**
 * The questions for a software workspace, in the order a person answers them.
 * Options bind only Vocion-side actions (workspace.describe, source.connect,
 * objects.create_group, autonomy.set_goal, autonomy.lower); a tracker change
 * is proposed after the answer, never bound.
 */
const SOFTWARE_QUESTIONS = [
  '1. Repos: options from browse_connection repos, each bound to source.connect.',
  '2. Products: follow the products-from-repos skill (binds objects.create_group).',
  '3. Tracker project: from browse_connection projects, bound source.connect with baseUrl, projectKeys and the sourceSlug the earlier source.connect result named.',
  '4. Contents and cleanup: follow the sweep-the-tracker skill; each cleanup is a proposed tracker change, never bound.',
  '5. Roadmap pace: options bind source.connect on the tracker source setting intakeStatuses and intakePerDay. "Everything that\'s ready" binds intakePerDay null; "only what I point you at" binds intakeStatuses null (a null replace value clears the key).',
  '6. Autonomy: a hands-off answer binds autonomy.set_goal, worded "Ship on green once I\'ve earned it"; a more careful answer may bind autonomy.lower. Never raise a rung in setup.',
  '7. Environments: follow the record-the-environments skill; offer the QA sign-in with offer_connection for app-login, never typed in chat.',
  '8. What first: options A-C are the highest-ranked open tickets in the intake statuses, never ones in progress, in QA or done. A typed answer is a new request: file it with file_request as intake-from-chat does, say so in one sentence, and start on it in this conversation. Never ask it again.',
].join('\n');

/**
 * One instruction per step. Each names exactly one path, because a model
 * follows every branch it is given (DESIGN-PRINCIPLES: one obvious path).
 */
const STEP_GUIDE: Record<OnboardingStep, string> = {
  describe: 'NEXT: the opener card has asked what to take off their plate. Take their answer and ask narrower questions with ask_choice. When you can say what the workspace is for in a sentence, offer it as option A bound to workspace.describe with {"description": "<that sentence>"}, and option B "Let me say it differently".',
  connect: 'NEXT: call list_capabilities, pick the plugin that fits the description, and for each connector in its recommend.connectors that is not connected, call offer_connection, one at a time, most useful first. You may offer any other connector the conversation points to.',
  grow: `NEXT: offer to turn on the plugins whose "Helps when" fits (recommend_action, action plugin.enable, input {"slug": "<slug>"}), call offer_connection for any connector they still need, then hand each enabled plugin's team lead the description with the task tool. Do these one at a time, waiting for the person's answer before the next. For a software workspace, ask in this order, one ask_choice per turn:\n${SOFTWARE_QUESTIONS}`,
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
    HOW_TO_ASK,
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
