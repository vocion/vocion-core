/**
 * Which GitLab connection serves a project, for THIS work — the GitLab twin
 * of `githubPullRead.repoAccess`.
 *
 * Only a project an enabled `gitlab` source lists is read or written, with
 * that source's own credential (a pasted access token, or a "Connect with
 * GitLab" login refreshed and saved before use), through the connection
 * resolver (`services/connect/connectionScope.ts`): the workspace's sources
 * and the work's own project's, never another project's, never the server's.
 * A project listed only by a connection another Vocion project holds is
 * refused with that project named.
 *
 * A source names its instance by `baseUrl` (gitlab.com when unset), so the
 * same project path on two instances is two projects: a caller that knows the
 * host (from a URL) asks for that host's.
 */

import type { ConnectionScope } from '@/services/connect/connectionScope';
import { hostOfBaseUrl, normalizeBaseUrl } from '@/libs/gitlab/client';
import { connectionsFor, connectionsWithheld, outOfScopeLine } from '@/services/connect/connectionScope';

/** A gitlab source row, as the access lookups read it. */
type GitlabRow = { id: number; slug: string; kind: string; configJson: unknown; apiTokenId: string | null };

/** What a project's connection gives a caller. */
export type GitlabProjectAccess = {
  token: string;
  baseUrl: string;
  sourceId: number;
  config: { deployBranch: string | null; branchPrefix: string | null };
};

/**
 * Whether a source row is a GitLab connection: its kind, or the connector a
 * row cloned from a pack records.
 * @param row - The row's kind, slug and config.
 * @param row.kind - `knowledge_source.kind`.
 * @param row.slug - `knowledge_source.slug`.
 * @param row.config - `knowledge_source.config_json`.
 */
export function isGitlabSource(row: { kind?: string | null; slug?: string | null; config?: unknown }): boolean {
  const connector = (row.config as { _connector?: unknown } | null | undefined)?._connector;
  return connector === 'gitlab' || (connector === undefined && (row.kind === 'gitlab' || row.slug === 'gitlab'));
}

/**
 * The projects a gitlab source's config lists.
 * @param config - `config_json`.
 */
export function projectsOf(config: unknown): string[] {
  const projects = (config as { projects?: unknown } | null)?.projects;
  return Array.isArray(projects) ? projects.map(String) : [];
}

/**
 * The instance host a gitlab source's config names.
 * @param config - `config_json`.
 */
export function hostOfSource(config: unknown): string {
  const base = (config as { baseUrl?: unknown } | null)?.baseUrl;
  return hostOfBaseUrl(typeof base === 'string' ? base : null);
}

function lists(row: { configJson: unknown }, project: string, host: string | null): boolean {
  const wanted = project.toLowerCase();
  return projectsOf(row.configJson).some(p => p.toLowerCase() === wanted) && (host === null || hostOfSource(row.configJson) === host);
}

/**
 * Every enabled gitlab connection this work may use.
 * @param orgId - The workspace.
 * @param scope - The work's scope; the current work's when omitted.
 */
export async function gitlabConnections(orgId: string, scope?: Partial<ConnectionScope> | null): Promise<GitlabRow[]> {
  return (await connectionsFor(orgId, scope)).filter(r => isGitlabSource({ kind: r.kind, slug: r.slug, config: r.configJson }));
}

/**
 * Whether an enabled gitlab connection of this work names an instance host —
 * how a self-managed host's URL is recognised as GitLab's.
 * @param orgId - The workspace.
 * @param host - A hostname, lowercased.
 */
export async function gitlabHostConnected(orgId: string, host: string): Promise<boolean> {
  return (await gitlabConnections(orgId)).some(r => hostOfSource(r.configJson) === host);
}

/**
 * Whether an enabled gitlab connection of this work lists a project path.
 * @param orgId - The workspace.
 * @param project - The project path.
 */
export async function gitlabListsProject(orgId: string, project: string): Promise<boolean> {
  return (await gitlabConnections(orgId)).some(r => lists(r, project, null));
}

/**
 * The instance a host or a project is on, as the work's gitlab connection
 * names it (keeping a path prefix a self-managed instance is served under);
 * gitlab.com when no connection says otherwise.
 * @param orgId - The workspace.
 * @param where - A hostname, or a project path a connection lists.
 * @param where.host - A hostname, lowercased.
 * @param where.project - A project path.
 */
export async function gitlabBaseUrlFor(orgId: string, where: { host?: string | null; project?: string | null }): Promise<string> {
  const rows = await gitlabConnections(orgId).catch(() => [] as GitlabRow[]);
  const row = where.project
    ? rows.find(r => lists(r, where.project!, null))
    : rows.find(r => hostOfSource(r.configJson) === where.host);
  const base = (row?.configJson as { baseUrl?: string } | null)?.baseUrl;
  return normalizeBaseUrl(base ?? (where.host && where.host !== 'gitlab.com' ? `https://${where.host}` : null));
}

/**
 * Every instance base URL the work's gitlab connections name, for parsing a
 * URL on an instance served under a path prefix.
 * @param orgId - The workspace.
 */
export async function gitlabBaseUrls(orgId: string): Promise<string[]> {
  return [...new Set((await gitlabConnections(orgId)).map(r => normalizeBaseUrl((r.configJson as { baseUrl?: string } | null)?.baseUrl)))];
}

/**
 * The credential for a project, for THIS work: the first gitlab connection in
 * scope that lists it (on the host asked for, when one is) and holds a working
 * credential; else null with the reason when another Vocion project holds it.
 * @param orgId - The workspace.
 * @param project - The project path.
 * @param opts - The instance host, when the caller knows it, and the work's scope.
 * @param opts.host - A hostname; any instance when omitted.
 * @param opts.scope - The work's scope; the current work's when omitted.
 */
export async function gitlabProjectAccess(orgId: string, project: string, opts: { host?: string | null; scope?: Partial<ConnectionScope> | null } = {}): Promise<{ access: GitlabProjectAccess; refusal: null } | { access: null; refusal: string | null }> {
  const rows = (await gitlabConnections(orgId, opts.scope)).filter(r => lists(r, project, opts.host ?? null));
  const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
  const { resolveGitlabAccess } = await import('@/libs/gitlab/token');
  for (const row of rows) {
    const creds = await getCredentialsForConnector({ orgId, connectorSlug: 'gitlab', apiTokenId: row.apiTokenId }).catch(() => undefined);
    const config = (row.configJson ?? {}) as { baseUrl?: string; deployBranch?: unknown; branchPrefix?: unknown };
    const resolved = await resolveGitlabAccess(creds as Record<string, unknown> | undefined, {
      kind: 'persist',
      orgId,
      sourceId: row.id,
      warn: message => console.warn('[gitlab] a renewed login could not be saved', { orgId, sourceId: row.id, message }),
    }, config.baseUrl).catch(() => null);
    if (resolved) {
      return {
        access: {
          token: resolved.token,
          baseUrl: resolved.baseUrl,
          sourceId: row.id,
          config: {
            deployBranch: typeof config.deployBranch === 'string' && config.deployBranch.trim() ? config.deployBranch.trim() : null,
            branchPrefix: typeof config.branchPrefix === 'string' && config.branchPrefix.trim() ? config.branchPrefix.trim() : null,
          },
        },
        refusal: null,
      };
    }
  }
  if (rows.length > 0) {
    return { access: null, refusal: null };
  }
  const wanted = project.toLowerCase();
  const withheld = (await connectionsWithheld(orgId, opts.scope).catch(() => [])).find(r => isGitlabSource({ kind: r.kind, slug: r.slug, config: r.configJson }) && projectsOf(r.configJson).some(p => p.toLowerCase() === wanted));
  return { access: null, refusal: withheld ? outOfScopeLine(`GitLab for ${project}`, withheld.projectTitle) : null };
}

/**
 * The credential for a project, or a thrown sentence saying why there is none.
 * @param orgId - The workspace.
 * @param project - The project path.
 * @param host - The instance host, when known.
 */
export async function requireGitlabAccess(orgId: string, project: string, host?: string | null): Promise<GitlabProjectAccess> {
  const got = await gitlabProjectAccess(orgId, project, { host });
  if (got.access) {
    return got.access;
  }
  throw new Error(got.refusal ?? `${project} is not a GitLab project this workspace connected with a working credential: add it to a gitlab source's projects, and connect GitLab (a login, or an access token with api for writes).`);
}
