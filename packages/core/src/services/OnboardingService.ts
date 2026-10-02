/**
 * Workspace onboarding (#1028). What setup reports is computed from rows
 * that already exist (the description, the connected sources, the enabled
 * plugins), so it can never claim a step that did not happen. The only
 * stored state is when setup was opened, which is what makes auto-open
 * fire once per workspace.
 */
import type { Card } from '@/libs/cards/card';
import { and, eq, isNull } from 'drizzle-orm';
import { CHOICE_OPTION_IDS, newCardId } from '@/libs/cards/card';
import { db } from '@/libs/DB';
import { connectorOfSource } from '@/libs/sources/connectorOf';
import { listConnectors } from '@/libs/sources/registry';
import { projectSchema } from '@/models/Schema';
import { listSources } from '@/services/SourceSyncService';

export type OnboardingStatus = {
  startedAt: Date | null;
  description: string | null;
  connectedConnectors: string[];
  enabledPlugins: string[];
  done: boolean;
};

export type OnboardingStep = 'describe' | 'connect' | 'grow';

/**
 * Where this workspace's setup stands.
 * @param orgId - The workspace (project) id.
 * @returns The status, or null when the workspace does not exist.
 */
export async function onboardingStatus(orgId: string): Promise<OnboardingStatus | null> {
  const [project] = await db
    .select({ startedAt: projectSchema.onboardingStartedAt, description: projectSchema.description, enabledPlugins: projectSchema.enabledPlugins })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!project) {
    return null;
  }
  const known = new Set(listConnectors().map(c => c.slug));
  const connectedConnectors = [...new Set((await listSources(orgId)).map(connectorOfSource))].filter(slug => known.has(slug)).sort();
  const description = project.description?.trim() ? project.description.trim() : null;
  return { startedAt: project.startedAt, description, connectedConnectors, enabledPlugins: project.enabledPlugins, done: description !== null && connectedConnectors.length > 0 };
}

/**
 * The one next step: describe, then connect, then grow (plugins and team hand-offs).
 * @param status - From `onboardingStatus`.
 * @returns The step `workspace_setup` tells the model to take.
 */
export function nextOnboardingStep(status: OnboardingStatus): OnboardingStep {
  if (!status.description) {
    return 'describe';
  }
  return status.connectedConnectors.length === 0 ? 'connect' : 'grow';
}

/**
 * Mark setup opened, atomically: of two admins opening a new workspace at
 * the same moment, exactly one wins.
 * @param orgId - The workspace.
 * @param userId - Who is opening it.
 * @returns True when this call opened it.
 */
export async function claimOnboardingStart(orgId: string, userId: string): Promise<boolean> {
  const rows = await db
    .update(projectSchema)
    .set({ onboardingStartedAt: new Date(), onboardingStartedBy: userId })
    .where(and(eq(projectSchema.id, orgId), isNull(projectSchema.onboardingStartedAt)))
    .returning({ id: projectSchema.id });
  return rows.length === 1;
}

/**
 * Undo a claim whose conversation could not be created, so the next visit
 * tries again. Only the claimer's own claim is released.
 * @param orgId - The workspace.
 * @param userId - The claimer.
 */
export async function releaseOnboardingStart(orgId: string, userId: string): Promise<void> {
  await db
    .update(projectSchema)
    .set({ onboardingStartedAt: null, onboardingStartedBy: null })
    .where(and(eq(projectSchema.id, orgId), eq(projectSchema.onboardingStartedBy, userId)));
}

/**
 * The lead's first message in the setup conversation. Written by code, not
 * a model: it costs nothing, and it reads the same for everyone.
 * @param input
 * @param input.workspaceName - The workspace's display name.
 * @param input.description - Its saved description, if any.
 * @returns Markdown.
 */
export function onboardingOpeningMessage(input: { workspaceName: string; description: string | null }): string {
  // The question lives on the opener card, so the prose asks nothing.
  const known = input.description ? [`You've described it as "${input.description}".`, ''] : [];
  return [
    `Welcome to **${input.workspaceName}**. I'll set it up with you, one question at a time: what it's for, which tools to connect, and what to turn on.`,
    '',
    ...known,
    'You can say "onboard this workspace" any time to pick this back up.',
  ].join('\n');
}

/** The most plugins the opener card offers: a choice card holds four options, and "type your own" is the fourth way in. */
const OPENER_MAX_OPTIONS = 3;

/**
 * Cut a sentence to a length on a word boundary.
 * @param text - The sentence.
 * @param max - The most characters to keep.
 * @returns The text, whole when it fits.
 */
function cutOnWord(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut.slice(0, max)).trimEnd();
}

/**
 * The setup conversation's first question as a choice card: which plugin's
 * work the person wants off their plate. Enabled plugins come first, then
 * catalog plugins that say when they help, each group in catalog order.
 * No option binds an action: the answer steers the interview, it changes nothing.
 * @param input
 * @param input.plugins - The catalog: slug, name and the plugin's `recommend.when` reasons.
 * @param input.enabled - Slugs already on in this workspace.
 * @returns A `choice` card.
 */
export function openerCard(input: { plugins: Array<{ slug: string; name: string; when: string[] }>; enabled: string[] }): Card {
  const on = input.plugins.filter(plugin => input.enabled.includes(plugin.slug));
  const recommended = input.plugins.filter(plugin => !input.enabled.includes(plugin.slug) && plugin.when.length > 0);
  const picked = [...on, ...recommended].slice(0, OPENER_MAX_OPTIONS);
  return {
    id: newCardId(),
    kind: 'choice',
    title: 'What do you want me taking off your plate?',
    body: 'Pick one, or type your own. I\'ll ask one thing at a time.',
    options: picked.map((plugin, index) => ({
      id: CHOICE_OPTION_IDS[index]!,
      label: plugin.name,
      ...(plugin.when[0] ? { description: cutOnWord(plugin.when[0], 200) } : {}),
    })),
    allowOther: true,
    actions: [],
    state: 'proposed',
    source: {},
  };
}

/**
 * Should the chat open setup for this visit? Only for an admin (only an
 * admin can connect a source), only once, only when there is a lead to
 * talk to, and never over a conversation the person came to resume.
 * @param input
 * @param input.orgId - The workspace.
 * @param input.role - The viewer's session role.
 * @param input.resuming - The visit names a conversation, a new chat or a prompt.
 * @returns True when the chat should call `onboarding.start`.
 */
export async function isOnboardingDue(input: { orgId: string; role: string | null; resuming: boolean }): Promise<boolean> {
  if (input.role !== 'admin' || input.resuming) {
    return false;
  }
  const [project] = await db
    .select({ startedAt: projectSchema.onboardingStartedAt, leadAgentSlug: projectSchema.leadAgentSlug })
    .from(projectSchema)
    .where(eq(projectSchema.id, input.orgId))
    .limit(1);
  return Boolean(project && project.startedAt === null && project.leadAgentSlug);
}
