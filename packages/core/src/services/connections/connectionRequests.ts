/**
 * A CONNECTION REQUEST (backlog 053): a gap in what the workspace can reach,
 * put in front of the person who can close it, and closed by the system the
 * moment it is.
 *
 * It is an ask, the noun we have: one per gap (the provider and the account
 * the repositories live on, so asking for three repositories on one GitHub
 * organization is one request), kind `credential`, its context link the one
 * move that closes it (GitHub's install screen, or the installation's
 * settings for a permission upgrade). Raised three ways, all through here:
 *
 *   - a person asks in chat, and the agent calls `request_connection`;
 *   - a factory action is refused for lack of access (no token for the
 *     repository, or GitHub answering 403 to a write);
 *   - the reconciler finds a repository the workspace's GitHub sources list
 *     that nothing can reach.
 *
 * `github.connected` (and the app's installation webhooks) close every open
 * request for that account: the ask is marked done by the system, with what
 * landed. A request the person turned down is not raised again by the
 * machinery; one that was closed and whose gap came back is raised afresh.
 *
 * The next provider costs a descriptor in `PROVIDERS`, not a subsystem.
 */

import type { Ask } from '@/services/AskService';
import { appBaseUrl } from '@/libs/links';

export const CONNECTION_REF_PREFIX = 'connection:';

export type ConnectionGapKind = 'install' | 'upgrade';

type ProviderDescriptor = {
  label: string;
  /** The account a resource lives on — the unit one connection covers. */
  accountOf: (resource: string) => string | null;
  /** Whether the workspace can already reach this resource. */
  reaches: (orgId: string, resource: string) => Promise<boolean>;
  /** The one move that closes the gap, absolute, and its words. */
  fix: (orgId: string, account: string, kind: ConnectionGapKind, returnTo: string | null) => Promise<{ url: string; label: string; needsApp: boolean }>;
};

const PROVIDERS: Record<string, ProviderDescriptor> = {
  github: {
    label: 'GitHub',
    accountOf: (repo) => {
      const m = /^([\w.-]+)\/[\w.-]+$/.exec(repo.trim());
      return m ? m[1]!.toLowerCase() : null;
    },
    async reaches(orgId, repo) {
      const { tokenForRepo } = await import('@/services/agents/tools/githubPullRead');
      return Boolean(await tokenForRepo(orgId, repo).catch(() => null));
    },
    async fix(orgId, account, kind, returnTo) {
      const base = appBaseUrl();
      const { activeApp, installationsForOrg, installationSettingsUrl } = await import('@/services/github/GithubAppService');
      if (!(await activeApp())) {
        return { url: `${base}/dashboard/connectors`, label: 'Create the GitHub App', needsApp: true };
      }
      if (kind === 'upgrade') {
        const row = (await installationsForOrg(orgId)).find(r => r.accountLogin.toLowerCase() === account);
        if (row) {
          return { url: installationSettingsUrl(row), label: 'Review the permissions on GitHub', needsApp: false };
        }
      }
      const q = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
      return { url: `${base}/api/v1/connections/github/install${q}`, label: 'Install on GitHub', needsApp: false };
    },
  },
};

export const CONNECTION_PROVIDERS = Object.keys(PROVIDERS) as [string, ...string[]];

/**
 * The ask's idempotency key for one gap.
 * @param provider - `github`.
 * @param account - The account, lowercased.
 * @param kind - Install or upgrade.
 */
export function connectionRef(provider: string, account: string, kind: ConnectionGapKind): string {
  return `${CONNECTION_REF_PREFIX}${provider}:${account.toLowerCase()}${kind === 'upgrade' ? ':upgrade' : ''}`;
}

export type RaisedConnection = {
  provider: string;
  account: string;
  kind: ConnectionGapKind;
  /** Already reachable: nothing was raised. */
  connected: boolean;
  askId: number | null;
  created: boolean;
  /** The person turned this request down earlier; it was not raised again. */
  declined: boolean;
  fixUrl: string | null;
  fixLabel: string | null;
  title: string;
  /** The ask input, for a caller filing it through `ask.file` (the chat card). */
  ask: {
    kind: 'credential';
    title: string;
    body: string;
    sourceRef: string;
    contextUrl: string | null;
    contextMd: string;
    decisionCost: number;
    risk: 'medium';
  } | null;
};

/**
 * What a connection request says, and its key, for each account the
 * resources live on. Resources the workspace already reaches are dropped.
 * @param input - The gap.
 * @param input.orgId - The workspace.
 * @param input.provider - `github`.
 * @param input.resources - `owner/name` repositories.
 * @param input.why - Why it is needed, in the requester's words.
 * @param input.kind - `install` (no access) or `upgrade` (access without the permission a call needed).
 * @param input.returnTo - Where the person lands after connecting (a chat, a feature).
 */
export async function describeConnectionGaps(input: { orgId: string; provider: string; resources: string[]; why: string; kind?: ConnectionGapKind; returnTo?: string | null }): Promise<RaisedConnection[]> {
  const provider = PROVIDERS[input.provider];
  if (!provider) {
    throw new Error(`no connection provider "${input.provider}"; known: ${CONNECTION_PROVIDERS.join(', ')}`);
  }
  const kind = input.kind ?? 'install';
  const byAccount = new Map<string, string[]>();
  for (const resource of input.resources) {
    const account = provider.accountOf(resource);
    if (!account) {
      throw new Error(`"${resource}" is not a ${provider.label} repository: write it owner/name`);
    }
    byAccount.set(account, [...(byAccount.get(account) ?? []), resource.trim()]);
  }
  const out: RaisedConnection[] = [];
  const { getAskBySourceRef } = await import('@/services/AskService');
  for (const [account, resources] of byAccount) {
    const missing = kind === 'install'
      ? (await Promise.all(resources.map(async r => ((await provider.reaches(input.orgId, r)) ? null : r)))).filter((r): r is string => r !== null)
      : resources;
    const title = kind === 'upgrade' ? `Grant ${provider.label} the access ${account} needs` : `Connect ${provider.label} for ${account}`;
    if (missing.length === 0) {
      out.push({ provider: input.provider, account, kind, connected: true, askId: null, created: false, declined: false, fixUrl: null, fixLabel: null, title, ask: null });
      continue;
    }
    const base = connectionRef(input.provider, account, kind);
    const earlier = await getAskBySourceRef(input.orgId, base);
    const declined = earlier?.status === 'rejected';
    // Closed once and the gap is back: a new request, keyed apart from the
    // decided one (a decided ask is never reopened).
    const sourceRef = earlier && earlier.status !== 'open' && !declined ? `${base}#${Date.now().toString(36)}` : base;
    const fix = await provider.fix(input.orgId, account, kind, input.returnTo ?? null);
    const list = missing.map(r => `- ${r}`).join('\n');
    const body = [
      input.why.trim(),
      fix.needsApp
        ? `This deployment has no ${provider.label} App yet: a workspace owner creates it once from Connections, then connects ${account}.`
        : kind === 'upgrade'
          ? `An owner of ${account} accepts the new permissions on ${provider.label}; this closes by itself when they land.`
          : `An owner of ${account} installs the ${provider.label} App on these repositories; this closes by itself when it lands.`,
    ].join('\n\n');
    out.push({
      provider: input.provider,
      account,
      kind,
      connected: false,
      askId: earlier && !declined && earlier.status === 'open' ? earlier.id : null,
      created: false,
      declined,
      fixUrl: fix.url,
      fixLabel: fix.label,
      title,
      ask: { kind: 'credential', title, body, sourceRef, contextUrl: fix.url, contextMd: `Repositories:\n${list}\n\n[${fix.label}](${fix.url})`, decisionCost: 2, risk: 'medium' },
    });
  }
  return out;
}

/**
 * Raise connection requests from the machinery (a refused call, the
 * reconciler): each gap filed as an ask straight away, deduplicated on its key.
 * A request the person declined stays declined.
 * @param input - As `describeConnectionGaps`, plus who is asking.
 * @param input.orgId - The workspace.
 * @param input.provider - `github`.
 * @param input.resources - `owner/name` repositories.
 * @param input.why - Why it is needed.
 * @param input.kind - Install or upgrade.
 * @param input.agentSlug - The seat raising it, when one is.
 */
export async function raiseConnectionGaps(input: { orgId: string; provider: string; resources: string[]; why: string; kind?: ConnectionGapKind; agentSlug?: string | null }): Promise<RaisedConnection[]> {
  const gaps = await describeConnectionGaps(input);
  const { upsertAsk } = await import('@/services/AskService');
  for (const gap of gaps) {
    if (!gap.ask || gap.declined) {
      continue;
    }
    const { ask, created } = await upsertAsk({ orgId: input.orgId, createdBy: input.agentSlug ? `agent:${input.agentSlug}` : 'system:connections', ask: { ...gap.ask, agentSlug: input.agentSlug ?? null } });
    gap.askId = ask.id;
    gap.created = created;
  }
  return gaps;
}

/**
 * A refused call's words, with the request that fixes it. Never throws: a
 * request that could not be raised leaves the refusal as it was.
 * @param input - The refusal.
 * @param input.orgId - The workspace.
 * @param input.repo - `owner/name`.
 * @param input.why - What was being done.
 * @param input.kind - Install (no token) or upgrade (a 403 on a write).
 */
export async function withConnectionRequest(input: { orgId: string; repo: string; why: string; kind: ConnectionGapKind }): Promise<string> {
  try {
    const [gap] = await raiseConnectionGaps({ orgId: input.orgId, provider: 'github', resources: [input.repo], why: input.why, kind: input.kind });
    if (!gap || gap.connected) {
      return '';
    }
    if (gap.declined) {
      return ` A request to connect ${gap.account} was turned down earlier; it was not raised again.`;
    }
    return ` A connection request is waiting for an owner of ${gap.account} (ask #${gap.askId}): ${gap.fixLabel} at ${gap.fixUrl}.`;
  } catch (err) {
    console.warn('[connections] could not raise a connection request', { orgId: input.orgId, repo: input.repo, error: (err as Error).message });
    return '';
  }
}

/**
 * Close every open request a landed connection answers: done, by the system,
 * saying what landed.
 * @param orgId - The workspace.
 * @param provider - `github`.
 * @param account - The account that was connected.
 * @param what - What landed, for the note.
 * @param kinds - Which gaps it closes; an install closes both.
 */
export async function closeConnectionRequests(orgId: string, provider: string, account: string, what: string, kinds: ConnectionGapKind[] = ['install', 'upgrade']): Promise<Ask[]> {
  const { and, eq, like } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { askSchema } = await import('@/models/Schema');
  const { decideAsk } = await import('@/services/AskService');
  const prefix = `${CONNECTION_REF_PREFIX}${provider}:${account.toLowerCase()}`;
  const open = await db.select().from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), like(askSchema.sourceRef, `${prefix}%`)));
  const closed: Ask[] = [];
  for (const ask of open) {
    const ref = String(ask.sourceRef).split('#')[0]!;
    const kind: ConnectionGapKind = ref.endsWith(':upgrade') ? 'upgrade' : 'install';
    if (ref !== prefix && ref !== `${prefix}:upgrade`) {
      continue;
    }
    if (!kinds.includes(kind)) {
      continue;
    }
    closed.push(await decideAsk({ orgId, id: ask.id, decision: 'done', note: what, decidedBy: `system:connections` }).catch(() => ask));
  }
  return closed;
}
