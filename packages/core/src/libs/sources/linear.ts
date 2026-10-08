/**
 * Linear connector — the issues of the Linear teams a source lists, as
 * retrievable documents (identifier, title, status, description); and the
 * GraphQL client the tracker family's Linear provider
 * (`services/tracker/providers/linear.ts`) reads and writes with.
 *
 * Auth: a personal API key (`lin_api_…`, sent bare in `Authorization`, as
 * Linear documents) or an OAuth access token (sent as Bearer). One endpoint,
 * `https://api.linear.app/graphql`; a GraphQL error comes back in `errors`
 * with a 200 or a 400, and is turned into the same sentence a refused REST
 * call gets.
 *
 * The tracker family calls a key prefix a project: on Linear it is the team
 * key (ENG in ENG-123), so the source lists them as `projectKeys`, and an
 * issue key routes to this source exactly as a Jira key routes to Jira's.
 *
 * Incremental (`ctx.since` set): issues with `updatedAt >=` the watermark
 * less five minutes. Full sync: every issue not completed or canceled, plus
 * the finished ones updated inside `doneWindowDays`, so long-closed issues
 * age out at the full reconcile — Jira's rule. Issues are keyed by Linear's
 * immutable id; the identifier changes when an issue moves teams.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { VendorResult } from '@/libs/connectors/vendorRequest';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { vendorRequest } from '@/libs/connectors/vendorRequest';
import { InspectInputError } from './inspect';

export const LINEAR_API_URL = 'https://api.linear.app/graphql';

const linearConfigSchema = z.object({
  /** Team keys — the prefix of the issue ids (ENG in ENG-123). Only these teams sync. */
  projectKeys: z.array(z.string().trim().min(1)).min(1, 'list at least one team key'),
  /** Full-sync scope for finished issues: keep ones updated within this window. */
  doneWindowDays: z.number().int().positive().default(90),
  /** Include the issue description in the embedded content. */
  includeDescription: z.boolean().default(true),
});

const WATERMARK_OVERLAP_MS = 5 * 60_000;
const MAX_PAGES = 100;

export const LINEAR_ISSUE_FIELDS = `
  id identifier title description url priority priorityLabel createdAt updatedAt
  state { id name type }
  team { id key name }
  assignee { name email }
  creator { name email }
  labels(first: 25) { nodes { id name } }
`;

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url: string;
  priority?: number | null;
  priorityLabel?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  state?: { id: string; name: string; type: string } | null;
  team?: { id: string; key: string; name: string } | null;
  assignee?: { name?: string | null; email?: string | null } | null;
  creator?: { name?: string | null; email?: string | null } | null;
  labels?: { nodes?: Array<{ id: string; name: string }> } | null;
};

/**
 * The token, or why there is none.
 * @param values - The decrypted credential bag.
 */
export function linearTokenFrom(values?: Record<string, unknown> | null): { ok: true; token: string } | { ok: false; message: string } {
  const token = typeof values?.token === 'string' ? values.token.trim() : (typeof values?.accessToken === 'string' ? values.accessToken.trim() : '');
  return token ? { ok: true, token } : { ok: false, message: 'No Linear API key is stored. Connect Linear on the Connectors page with a personal API key.' };
}

/**
 * The `Authorization` header Linear wants: a personal key bare, an OAuth
 * token as Bearer.
 * @param token - The key or token.
 */
export function linearAuthorization(token: string): string {
  return token.startsWith('lin_api_') ? token : `Bearer ${token}`;
}

/**
 * One GraphQL call, its errors shaped like any other refusal.
 * @param token - The key or token.
 * @param query - The query or mutation.
 * @param variables - Its variables.
 */
export async function linearGraphql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<VendorResult<T>> {
  const res = await vendorRequest<{ data?: T; errors?: Array<{ message?: string; extensions?: { code?: string; type?: string } }> }>({
    vendor: 'Linear',
    url: LINEAR_API_URL,
    method: 'POST',
    json: { query, variables },
    headers: { authorization: linearAuthorization(token) },
    authHint: 'Check the API key: Settings → Account → Security & access.',
  });
  if (!res.ok) {
    return res;
  }
  const first = res.data?.errors?.[0];
  if (first) {
    const code = first.extensions?.code ?? first.extensions?.type ?? '';
    const unauthorized = /AUTHENTICATION|FORBIDDEN/i.test(code);
    return {
      ok: false,
      kind: unauthorized ? 'unauthorized' : (/RATELIMIT/i.test(code) ? 'rate_limited' : 'vendor_error'),
      status: res.status,
      message: `Linear refused the request: ${first.message ?? code}.${unauthorized ? ' Check the API key: Settings → Account → Security & access.' : ''}`,
    };
  }
  if (!res.data?.data) {
    return { ok: false, kind: 'vendor_error', status: res.status, message: 'Linear answered with no data.' };
  }
  return { ok: true, data: res.data.data, status: res.status, headers: res.headers };
}

/**
 * The tracker family's fixed status category for a Linear workflow state
 * type: `new`, `indeterminate` or `done`.
 * @param type - The state's type (`backlog`, `unstarted`, `started`, `completed`, `canceled`, `triage`).
 */
export function linearStatusCategory(type: string | null | undefined): string {
  if (type === 'completed' || type === 'canceled') {
    return 'done';
  }
  return type === 'started' ? 'indeterminate' : 'new';
}

/**
 * The GraphQL filter for one sync run.
 * @param opts - Team scope, window and watermark.
 * @param opts.projectKeys - The team keys.
 * @param opts.since - The incremental watermark, or null for a full run.
 * @param opts.doneWindowDays - How long finished issues stay on a full run.
 * @param opts.now - Injected for tests.
 */
export function linearSyncFilter(opts: { projectKeys: string[]; since?: Date | null; doneWindowDays: number; now?: Date }): Record<string, unknown> {
  const team = { key: { in: opts.projectKeys.map(k => k.toUpperCase()) } };
  if (opts.since) {
    return { team, updatedAt: { gte: new Date(opts.since.getTime() - WATERMARK_OVERLAP_MS).toISOString() } };
  }
  const windowStart = new Date((opts.now ?? new Date()).getTime() - opts.doneWindowDays * 86_400_000).toISOString();
  return { team, or: [{ state: { type: { nin: ['completed', 'canceled'] } } }, { updatedAt: { gte: windowStart } }] };
}

/**
 * The searchable document for one issue.
 * @param issue - The issue.
 * @param includeDescription - Whether the description is embedded.
 */
export function linearIssueDoc(issue: LinearIssue, includeDescription: boolean): IngestDoc {
  const status = issue.state?.name ?? 'Unknown';
  const statusCategory = linearStatusCategory(issue.state?.type);
  return {
    externalId: `linear:${issue.id}`,
    title: `[${issue.identifier}] ${issue.title}`,
    content: [`${issue.identifier} — ${issue.title}`, `Status: ${status}`, includeDescription ? (issue.description ?? '') : ''].filter(Boolean).join('\n'),
    uri: issue.url,
    lastModifiedAt: issue.updatedAt ? new Date(issue.updatedAt) : null,
    metadata: {
      type: 'issue',
      key: issue.identifier,
      linearId: issue.id,
      projectKey: issue.team?.key ?? issue.identifier.split('-')[0],
      status,
      statusCategory,
      completed: issue.state?.type === 'completed',
      priority: issue.priorityLabel ?? null,
      labels: (issue.labels?.nodes ?? []).map(l => l.name),
      assignee: issue.assignee?.email ?? issue.assignee?.name ?? null,
      created: issue.createdAt ?? null,
      updated: issue.updatedAt ?? null,
    },
  };
}

type IssuesPage = { issues: { nodes: LinearIssue[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };

/**
 * Test connection: whose key it is, and that each team key is reachable.
 * @param config - The source config (`projectKeys`).
 * @param values - The credential values.
 */
export async function inspectLinear(config: Record<string, unknown>, values: Record<string, unknown>): Promise<ConnectorInspection> {
  const parsed = linearTokenFrom(values);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const keys = Array.isArray(config.projectKeys) ? (config.projectKeys as unknown[]).map(k => String(k).trim().toUpperCase()).filter(Boolean) : [];
  const res = await linearGraphql<{ viewer: { name?: string; email?: string; organization?: { name?: string } }; teams: { nodes: Array<{ key: string; name: string }> } }>(parsed.token, 'query { viewer { name email organization { name } } teams(first: 250) { nodes { key name } } }');
  if (!res.ok) {
    return { reachable: res.kind !== 'unreachable', authorized: false, checks: [{ key: 'account', label: 'Signs in to Linear', ok: false, detail: res.message }], note: null, error: res.message };
  }
  const checks: ConnectorCheck[] = [{ key: 'account', label: 'Signs in to Linear', ok: true, detail: `${res.data.viewer.name ?? res.data.viewer.email ?? 'user'} in ${res.data.viewer.organization?.name ?? 'the workspace'}` }];
  const teams = new Map(res.data.teams.nodes.map(t => [t.key.toUpperCase(), t.name]));
  for (const key of keys) {
    checks.push({ key: `team:${key}`, label: `Team ${key}`, ok: teams.has(key), detail: teams.get(key) ?? `Not a team this key can see (it sees ${[...teams.keys()].join(', ') || 'none'}).` });
  }
  const failed = checks.filter(c => !c.ok);
  return { reachable: true, authorized: true, checks, note: null, error: failed.length > 0 ? failed.map(c => c.detail).join(' ') : null };
}

export const linearConnector: SourceConnector<typeof linearConfigSchema> = {
  slug: 'linear',
  brand: 'linear',
  name: 'Linear',
  description: 'Issues from Linear teams: identifier, title, status and description, synced incrementally by updated time. Agents read and update issues through the issue-tracker tools.',
  icon: 'SquareKanban',
  authKind: 'apikey',
  configSchema: linearConfigSchema,
  defaultReconcileCron: '15 3 * * *',
  inspectNote: 'Reads whose key it is and checks each team key is reachable. Read-only. Nothing is saved.',

  async inspect({ config, credentials }) {
    return inspectLinear(config, credentials);
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = linearConfigSchema.parse(ctx.config);
    const parsed = linearTokenFrom(ctx.credentials);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    const filter = linearSyncFilter({ projectKeys: cfg.projectKeys, since: ctx.since, doneWindowDays: cfg.doneWindowDays });
    const query = `query Issues($filter: IssueFilter, $after: String) { issues(filter: $filter, first: 100, after: $after) { nodes { ${LINEAR_ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } } }`;
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res: VendorResult<IssuesPage> = await linearGraphql<IssuesPage>(parsed.token, query, { filter, after });
      if (!res.ok) {
        throw new Error(res.message);
      }
      for (const issue of res.data.issues.nodes) {
        ctx.onProgress?.({ kind: 'fetched', uri: issue.identifier });
        yield linearIssueDoc(issue, cfg.includeDescription);
      }
      if (!res.data.issues.pageInfo.hasNextPage || !res.data.issues.pageInfo.endCursor) {
        return;
      }
      after = res.data.issues.pageInfo.endCursor;
    }
    ctx.onProgress?.({ kind: 'error', message: `Linear sync stopped at the ${MAX_PAGES}-page cap; the rest lands on the next run.` });
  },
};
