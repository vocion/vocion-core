/**
 * THE TRACKER FAMILY — an issue tracker as the factory sees it.
 *
 * A request arrives on a board the client already runs; the plan, the pull
 * request and the release all have to be written back where the client reads
 * them. Those reads and writes are the same on every tracker: an issue, its
 * status transitions, its comments, its attachments, its fields. So the
 * agent's tools and actions are named for those constructs (`tracker_read_issue`,
 * `tracker.transition_issue`) and this interface is what each provider fills
 * in. Jira is the first provider (`providers/jira.ts`) and Linear the second
 * (`providers/linear.ts`); Azure Boards and GitHub Issues implement the same
 * interface and the agent's skills change not a word.
 *
 * Which provider answers is decided by the workspace's sources
 * (`libs/connectors/families.ts`): the tracker source whose configured
 * projects include an issue key's prefix, else the workspace's only tracker
 * source. An agent never names a vendor; the source does.
 */

import type { Buffer } from 'node:buffer';
import type { FamilySource } from '@/libs/connectors/families';
import { familySourcesForOrg } from '@/libs/connectors/families';

export type TrackerComment = { id: string; author: string | null; created: string | null; body: string };
export type TrackerAttachment = { id: string; filename: string; mimeType: string | null; size: number | null; created: string | null };
export type TrackerTransition = { id: string; name: string; to: string };
export type TrackerIssueLink = { type: string; key: string; summary: string | null };

export type TrackerIssue = {
  key: string;
  url: string;
  summary: string;
  description: string;
  status: string;
  /** The provider's fixed three-value category: `new`, `indeterminate` or `done` on Jira. */
  statusCategory: string | null;
  issueType: string | null;
  priority: string | null;
  labels: string[];
  assignee: string | null;
  reporter: string | null;
  created: string | null;
  updated: string | null;
  fixVersions: string[];
  comments: TrackerComment[];
  attachments: TrackerAttachment[];
  links: TrackerIssueLink[];
  /** The status transitions available from the issue's current status. */
  transitions: TrackerTransition[];
};

export type TrackerSearchRow = { key: string; summary: string; status: string; assignee: string | null; updated: string | null; url: string };

export type TrackerFieldUpdate = {
  priority?: string;
  labels?: string[];
  fixVersion?: string;
  /** A remote issue link (Jira's name for a link to a page outside the tracker). */
  remoteLink?: { url: string; title: string };
};

/** What `updateIssue` overwrote, so Undo can put it back. */
export type TrackerPreviousFields = {
  priority?: string | null;
  labels?: string[];
  fixVersions?: string[];
  /** The id of the remote issue link the update added, when it added one. */
  remoteLinkId?: string | null;
};

export type TrackerProvider = {
  /** The connector kind behind this provider (`jira`). */
  kind: string;
  /** The source slug it answers for. */
  sourceSlug: string;
  /** The projects (keys) this source is configured for. */
  projectKeys: string[];
  readIssue: (key: string) => Promise<TrackerIssue>;
  /**
   * A search in the provider's own query language, bounded to the configured
   * projects by the provider itself: a query never leaves them.
   */
  searchIssues: (query: string, limit: number) => Promise<TrackerSearchRow[]>;
  readAttachment: (id: string) => Promise<{ filename: string; mimeType: string; bytes: Buffer }>;
  createIssue: (input: { projectKey: string; issueType: string; summary: string; description: string; labels?: string[]; priority?: string }) => Promise<{ key: string; url: string }>;
  deleteIssue: (key: string) => Promise<void>;
  transitions: (key: string) => Promise<TrackerTransition[]>;
  /** Move an issue to a status, named by the status or by a transition id. */
  transition: (key: string, to: string) => Promise<{ from: string; to: string }>;
  updateIssue: (key: string, fields: TrackerFieldUpdate) => Promise<TrackerPreviousFields>;
  removeRemoteLink: (key: string, linkId: string) => Promise<void>;
  addComment: (key: string, text: string) => Promise<{ id: string; url: string }>;
  deleteComment: (key: string, id: string) => Promise<void>;
  attach: (key: string, file: { filename: string; mimeType: string; bytes: Buffer }) => Promise<{ id: string }>;
  deleteAttachment: (id: string) => Promise<void>;
  findUserByEmail: (email: string) => Promise<{ accountId: string; displayName: string } | null>;
  /** The link to an issue on the tracker's own site. */
  issueUrl: (key: string) => string;
};

/**
 * The project prefix of an issue key: `NOCO-123` → `NOCO`. Null for a string
 * that is not an issue key.
 * @param key - An issue key as a person types it.
 */
export function projectKeyOf(key: string): string | null {
  const m = /^([A-Z]\w*)-\d+$/i.exec(key.trim());
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * The configured project keys of a tracker source, whichever provider it is.
 * @param source - The source row.
 */
export function projectKeysOf(source: FamilySource): string[] {
  const keys = (source.config as { projectKeys?: unknown }).projectKeys;
  return Array.isArray(keys) ? keys.map(k => String(k).toUpperCase()) : [];
}

/**
 * The provider for an issue, or for the workspace's one tracker.
 *
 * With `issueKey`: the source whose configured projects include the key's
 * prefix. With `sourceSlug`: that source. Otherwise the workspace's only
 * tracker source. Anything else is an error that names what is connected,
 * so the agent can say which board it can and cannot reach.
 * @param orgId - The workspace.
 * @param opts - What to resolve by.
 * @param opts.issueKey - An issue key, when the call is about one issue.
 * @param opts.sourceSlug - A source slug, when the caller already knows the source.
 */
export async function trackerProviderFor(orgId: string, opts: { issueKey?: string | null; sourceSlug?: string | null } = {}): Promise<TrackerProvider> {
  const sources = await familySourcesForOrg(orgId, 'tracker');
  if (sources.length === 0) {
    throw new Error('This workspace has no issue tracker connected. Connect one (Jira or Linear) at /dashboard/connectors and give this agent the source.');
  }
  let chosen: FamilySource | undefined;
  if (opts.sourceSlug) {
    chosen = sources.find(s => s.slug === opts.sourceSlug);
    if (!chosen) {
      throw new Error(`No tracker source named ${opts.sourceSlug}. Connected: ${describe(sources)}.`);
    }
  } else if (opts.issueKey) {
    const project = projectKeyOf(opts.issueKey);
    if (!project) {
      throw new Error(`${opts.issueKey} is not an issue key (expected PROJECT-123).`);
    }
    chosen = sources.find(s => projectKeysOf(s).includes(project));
    if (!chosen) {
      throw new Error(`No connected tracker source is configured for project ${project}. Connected: ${describe(sources)}. A project is added on the source, not here.`);
    }
  } else {
    if (sources.length > 1) {
      throw new Error(`This workspace has ${sources.length} tracker sources; name one (sourceSlug) or an issue key. Connected: ${describe(sources)}.`);
    }
    chosen = sources[0]!;
  }
  return providerFor(orgId, chosen);
}

/**
 * Every tracker provider the workspace has, for a lookup across all of them.
 * @param orgId - The workspace.
 */
export async function trackerProvidersFor(orgId: string): Promise<TrackerProvider[]> {
  const sources = await familySourcesForOrg(orgId, 'tracker');
  return Promise.all(sources.map(s => providerFor(orgId, s)));
}

async function providerFor(orgId: string, source: FamilySource): Promise<TrackerProvider> {
  if (source.kind === 'jira') {
    const { jiraTrackerProvider } = await import('./providers/jira');
    return jiraTrackerProvider(orgId, source);
  }
  if (source.kind === 'linear') {
    const { linearTrackerProvider } = await import('./providers/linear');
    return linearTrackerProvider(orgId, source);
  }
  throw new Error(`${source.slug} is a ${source.kind} source, which no tracker provider serves yet.`);
}

function describe(sources: FamilySource[]): string {
  return sources.map(s => `${s.slug} (${s.kind}: ${projectKeysOf(s).join(', ') || 'no projects'})`).join('; ');
}
