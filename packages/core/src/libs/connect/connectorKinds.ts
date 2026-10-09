/**
 * The two kinds of connector, named once (founder, 2026-10-09):
 *
 * - **Team connectors** — shared. The workspace's agents read them, and an Org
 *   or workspace admin connects and manages them, on Manage workspace →
 *   Team connectors.
 * - **Personal connectors** — yours only: your own Gmail, Calendar, Drive,
 *   Slack DMs and GitHub, read only by your personal assistant, on Personal →
 *   Personal connectors.
 *
 * Every surface that names a kind — the two pages, the connect sheet, the
 * agents' tool results and descriptions, the opening hints — takes the words
 * from here, so the terms cannot drift apart. Pure and client-safe.
 *
 * Which kind a request means is read by the model from the person's words
 * ("connect my inbox" is personal; "connect HubSpot for the team" is team) and
 * passed to the tools as a typed field; nothing here matches words.
 */

import { personalConnectionFor } from '@/libs/personal/connections';

export type ConnectorKind = 'team' | 'personal';

/** What each kind is called, wherever it is named. */
export const CONNECTOR_KIND_NAME: Record<ConnectorKind, string> = {
  team: 'Team connectors',
  personal: 'Personal connectors',
};

/** One connector of a kind, mid-sentence: "a team connector". */
export const CONNECTOR_KIND_ONE: Record<ConnectorKind, string> = {
  team: 'a team connector',
  personal: 'a personal connector',
};

/** Who reads each kind and who connects it, in one clause. */
export const CONNECTOR_KIND_WHO: Record<ConnectorKind, string> = {
  team: 'your team\'s agents use it, and an admin connects it',
  personal: 'only your personal assistant reads it, and only you can connect it',
};

/** Where each kind is connected: the same path in either workspace. */
export const CONNECTORS_PATH = '/dashboard/connectors';

/**
 * The kind a workspace's Connectors page holds: Personal holds personal
 * connectors, every shared workspace holds team ones.
 * @param workspaceKind - `project.kind`.
 */
export function kindOfWorkspace(workspaceKind: string | null | undefined): ConnectorKind {
  return workspaceKind === 'personal' ? 'personal' : 'team';
}

/**
 * Whether a connector can be a personal connector at all (Gmail, Calendar,
 * Drive, Slack DMs, GitHub). Every connector can be a team connector.
 * @param slug - A connector slug.
 */
export function canBePersonal(slug: string): boolean {
  return personalConnectionFor(slug) !== null;
}

/**
 * The one line said when a request needs the other kind than this workspace
 * holds — instead of a card that would connect the wrong kind. Names the
 * system, the kind it needs, who reads it, and where it is connected.
 * @param input - What was asked.
 * @param input.name - The system's name, as a person reads it.
 * @param input.needs - The kind the request needs.
 * @param input.href - Where that kind is connected, when it can be linked.
 */
export function wrongKindLine(input: { name: string; needs: ConnectorKind; href?: string | null }): string {
  const where = input.href ? `[${CONNECTOR_KIND_NAME[input.needs]}](${input.href})` : CONNECTOR_KIND_NAME[input.needs];
  return `${input.name} is ${CONNECTOR_KIND_ONE[input.needs]} — ${CONNECTOR_KIND_WHO[input.needs]}. Connect it in ${where}.`;
}
