/**
 * WHAT A WORKSPACE'S LEAD IS CALLED.
 *
 * The founder (2026-10-09): never "Workspace lead". The lead's role name is
 * the workspace's own: "Revenue lead", "Support lead", "Northwind lead". It is
 * computed from the workspace's CURRENT name every time it is shown, so it
 * follows a rename. An Org may give the lead a first name ("Ava"); then it
 * reads "Ava · Revenue lead".
 *
 * Storage: the agent's own `name`. The seeded lead is written with a
 * placeholder name (`templates/workspace/agents/workspace-lead.yaml`), and a
 * placeholder means "no given name": the role is shown. Any other name an Org
 * sets is the lead's given name. No migration: rows seeded before this carry
 * the old placeholder, which reads the same way.
 *
 * Applies to the seeded lead (`WORKSPACE_LEAD_SLUG`) only. A lead a workspace
 * authored in its YAML keeps the name it was given, and a personal
 * workspace's assistant stays its assistant.
 *
 * Pure and client-safe: the chat surface, the profile, the Teams page and the
 * lead's own prompt all name it the same way.
 */

import { workspaceGreeting } from '@/services/chat/workspaceLabel';
import { WORKSPACE_LEAD_SLUG } from './workspaceLead';

/** What the seeded lead is stored as when nobody gave it a name (the template's `name:`). */
export const LEAD_PLACEHOLDER_NAME = 'Lead';

/** Names the seeded lead carries when nobody gave it one: the template's, then and now. */
const PLACEHOLDER_NAMES = new Set(['lead', 'workspace lead']);

/** The longest a workspace's name runs inside a role name before it is cut. */
const ROLE_WORKSPACE_MAX = 24;

export type LeadName = {
  /** The given name ("Ava"), or null when the Org gave it none. */
  given: string | null;
  /** The role, from the workspace's name ("Revenue lead"). */
  role: string;
  /** What a person reads: "Ava · Revenue lead", or "Revenue lead". */
  label: string;
  /** What the lead is called in a sentence: "Ava", or "Revenue lead". */
  short: string;
};

/**
 * The short workspace name a role is built from: the project's leading word
 * with the Org's prefix stripped, the Org's name for a generic project
 * ("Default project" → "Northwind"), cut at a sensible length.
 * @param accountName - The Org's name.
 * @param projectName - The workspace's name.
 */
export function leadWorkspaceLabel(accountName: string | null | undefined, projectName: string | null | undefined): string {
  const label = workspaceGreeting(accountName, projectName).workspace;
  return label.length > ROLE_WORKSPACE_MAX ? `${label.slice(0, ROLE_WORKSPACE_MAX - 1).trimEnd()}…` : label;
}

/**
 * The given name an agent row carries, or null for a placeholder.
 * @param agentName - The agent's stored name.
 */
export function leadGivenName(agentName: string | null | undefined): string | null {
  const name = (agentName ?? '').trim();
  return name && !PLACEHOLDER_NAMES.has(name.toLowerCase()) ? name : null;
}

/**
 * What the seeded lead is called in a workspace.
 * @param input - What the name is made of.
 * @param input.agentName - The lead's stored name.
 * @param input.workspaceLabel - The workspace's short name ({@link leadWorkspaceLabel}).
 */
export function leadName(input: { agentName: string | null | undefined; workspaceLabel: string }): LeadName {
  const given = leadGivenName(input.agentName);
  const role = `${input.workspaceLabel} lead`;
  return { given, role, label: given ? `${given} · ${role}` : role, short: given ?? role };
}

/**
 * Whether an agent is the seeded lead, the one named this way.
 * @param slug - The agent's slug.
 */
export function isSeededLead(slug: string): boolean {
  return slug === WORKSPACE_LEAD_SLUG;
}
