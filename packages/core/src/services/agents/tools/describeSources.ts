/**
 * describe_sources — what the agent's connected sources actually reach.
 *
 * "Which repositories do you have access to?" has one right answer: the
 * repositories the `github` source lists, checked against what the GitHub
 * App installation was granted — asked of GitHub now, not read from the
 * operating intent. On 2026-09-30 the Noco product manager answered that
 * question by looking up `repo` records (none filed), searching the index
 * (nothing ingested) and quoting the intent, because no tool said what the
 * sources reach. This is that tool.
 *
 * Per source the agent may read: the connector, what the source is scoped to
 * (repositories, project keys, channels, as its config says), whether a
 * credential is stored, the account the grant is on, what the vendor says
 * that account grants (live for a GitHub App installation; the stored snapshot
 * otherwise), the last run and how many documents the index holds. Names
 * only: no token, id or secret is read into the answer.
 */
import type { RuntimeContext } from '../types';
import type { GrantSummary } from '@/libs/connect/provider';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { installationRepositories } from '@/libs/connect/providers/github';
import { grantSummaryForSource } from '@/libs/connect/summary';
import { installationIdFrom, installationToken } from '@/libs/github/app';
import { GITHUB_API_URL } from '@/libs/github/client';
import { credentialStatusForOrg, getCredentialsForSource } from '@/services/SourceCredentialService';
import { documentCountsForOrg, latestSyncStateForOrg, listSources } from '@/services/SourceSyncService';

/** Config keys that are credentials or plumbing, never scope. */
const NOT_SCOPE = /token|secret|password|key|credential|auth|^_|schedule|enabled|objectType|lookback|reconcile/i;

/**
 * The scope a source's config declares, as "label: value" lines, in the order
 * a reader wants: the list that bounds what is read first.
 * @param config - The source's config, as stored.
 */
export function scopeLines(config: Record<string, unknown>): string[] {
  const named: Array<[string, string]> = [
    ['repos', 'Repositories'],
    ['branchPrefix', 'Only branches starting with'],
    ['deployBranch', 'Deploy branch'],
    ['projectKeys', 'Jira projects'],
    ['baseUrl', 'Site'],
    ['channels', 'Channels'],
    ['channel', 'Channel'],
  ];
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const [key, label] of named) {
    const value = config[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    seen.add(key);
    lines.push(`${label}: ${Array.isArray(value) ? value.map(String).join(', ') : String(value)}`);
  }
  for (const [key, value] of Object.entries(config)) {
    if (seen.has(key) || NOT_SCOPE.test(key) || value === undefined || value === null || value === '') {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key}: ${String(value)}`);
    } else if (Array.isArray(value) && value.every(v => typeof v === 'string' || typeof v === 'number')) {
      lines.push(`${key}: ${value.map(String).join(', ')}`);
    }
  }
  return lines;
}

/**
 * The repositories a GitHub App installation grants, asked of GitHub now, or
 * null when the credential is not an installation or GitHub did not answer.
 * @param credentials - The source's decrypted bag, when any.
 */
async function liveInstallationRepositories(credentials: Record<string, unknown> | undefined): Promise<string[] | null> {
  const installationId = installationIdFrom(credentials);
  if (!installationId) {
    return null;
  }
  try {
    const baseUrl = typeof credentials?.baseUrl === 'string' && credentials.baseUrl ? credentials.baseUrl : GITHUB_API_URL;
    return await installationRepositories(await installationToken(installationId, { baseUrl }), baseUrl);
  } catch {
    return null;
  }
}

/**
 * The repositories the source lists, each against what the grant covers.
 * @param listed - `config.repos`.
 * @param granted - What the installation grants, live or as stored.
 * @param live - Whether `granted` came from GitHub just now.
 */
export function repositoryLines(listed: string[], granted: string[], live: boolean): string[] {
  const grantedSet = new Set(granted.map(r => r.toLowerCase()));
  const listedSet = new Set(listed.map(r => r.toLowerCase()));
  const lines: string[] = [];
  for (const repo of listed) {
    lines.push(grantedSet.has(repo.toLowerCase())
      ? `  - ${repo} — in the source's list and granted to the app${live ? '' : ' (as of connecting)'}`
      : `  - ${repo} — in the source's list but NOT granted to the app: the sync cannot read it until the installation includes it`);
  }
  for (const repo of granted) {
    if (!listedSet.has(repo.toLowerCase())) {
      lines.push(`  - ${repo} — granted to the app but not in the source's list, so it is not read`);
    }
  }
  return lines;
}

export function describeSourcesTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const only = typeof (args as { source?: string }).source === 'string' ? (args as { source: string }).source.trim() : '';
      const [sources, credStatus, docCounts, syncState] = await Promise.all([
        listSources(ctx.orgId),
        credentialStatusForOrg(ctx.orgId),
        documentCountsForOrg(ctx.orgId),
        latestSyncStateForOrg(ctx.orgId),
      ]);
      const mine = sources.filter((s) => {
        const connector = (s.config?._connector as string | undefined) ?? s.slug;
        const reachable = ctx.connectorSources.includes(s.slug) || ctx.connectorSources.includes(connector);
        return reachable && (!only || s.slug === only || connector === only);
      });
      if (mine.length === 0) {
        return only
          ? `No connected source named "${only}" is readable by this agent. Sources this agent can read: ${ctx.connectorSources.join(', ') || 'none'}.`
          : `This agent reads no connected sources (connectorSources is empty).`;
      }

      const blocks: string[] = [];
      for (const s of mine) {
        const connector = (s.config?._connector as string | undefined) ?? s.slug;
        const status = credStatus.bySourceId[s.id] ?? credStatus.byConnectorSlug[connector];
        const connected = status?.connected ?? false;
        const lines: string[] = [`${s.slug} (${connector} connector)${s.enabled === 'true' ? '' : ' — DISABLED'}`];
        for (const line of scopeLines(s.config ?? {})) {
          lines.push(`  ${line}`);
        }
        if (!connected) {
          lines.push(`  Credential: none stored${status?.broken ? ` (${status.broken})` : ''} — nothing is read until a person connects it at /dashboard/connectors`);
        } else {
          const grant: GrantSummary | null = await grantSummaryForSource({ orgId: ctx.orgId, sourceSlug: s.slug, connectorSlug: connector });
          lines.push(grant ? `  Connected as: ${grant.account}` : `  Credential: stored (a pasted token — the vendor was not asked what it covers)`);
          if (connector === 'github') {
            const listed = Array.isArray(s.config?.repos) ? (s.config.repos as unknown[]).filter((r): r is string => typeof r === 'string') : [];
            const credentials = await getCredentialsForSource(ctx.orgId, s.slug).catch(() => undefined);
            const live = await liveInstallationRepositories(credentials);
            const granted = live ?? grant?.granted?.items ?? null;
            if (granted) {
              lines.push(`  Repositories the app is granted (${live ? 'asked of GitHub now' : 'as stored when connected'}): ${granted.length}`);
              lines.push(...repositoryLines(listed, granted, live !== null));
            } else if (listed.length > 0) {
              lines.push(`  Repositories (from the source's list; the token's reach was not checked): ${listed.join(', ')}`);
            }
          } else if (grant?.granted && grant.granted.items.length > 0) {
            lines.push(`  ${grant.granted.label} granted: ${grant.granted.items.join(', ')}`);
          }
        }
        const sync = syncState[s.id];
        const docs = docCounts[s.id] ?? 0;
        if (sync) {
          const kept = (sync.counts.created ?? 0) + (sync.counts.updated ?? 0) + (sync.counts.unchanged ?? 0);
          const skipped = sync.counts.skipped ?? 0;
          let run = `  Last run: ${sync.status} ${sync.completedAt ? `at ${sync.completedAt.toISOString()}` : `(started ${sync.startedAt.toISOString()})`}, ${docs} document${docs === 1 ? '' : 's'} in the index`;
          if (sync.status === 'completed' && kept === 0 && skipped > 0) {
            run += `; read ${skipped} item${skipped === 1 ? '' : 's'} and kept none${sync.skipped?.[0] ? `: ${sync.skipped[0].message}` : ''}`;
          } else if (sync.error) {
            run += `; error: ${sync.error}`;
          }
          lines.push(run);
        } else {
          lines.push(`  Last run: never synced, ${docs} document${docs === 1 ? '' : 's'} in the index`);
        }
        blocks.push(lines.join('\n'));
      }
      return blocks.join('\n\n');
    },
    {
      name: 'describe_sources',
      description: 'What this agent\'s connected sources actually reach: for each source, what it is scoped to (repositories, Jira projects, channels), whether a credential is stored and whose account it is on, what the vendor grants that account (asked of GitHub live for an app installation), the last sync and how many documents are indexed. Use this for "what repositories / projects / channels do you have access to", "is X connected", or when a search returns nothing and you need to know whether the source has read anything at all. Read-only.',
      schema: z.object({ source: z.string().optional().describe('One source or connector slug to describe, e.g. "github". Omit for every source this agent can read.') }),
    },
  );
}
