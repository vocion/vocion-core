/**
 * AFTER A GITHUB INSTALL, THE CONNECTION IS FINISHED — and says what it
 * covers.
 *
 * 2026-10-29, prod: an SEO lead installed this deployment's GitHub App on
 * their own agency's organization. The client's site lives in the CLIENT'S
 * organization, where they are not an owner. Vocion stored the login (a
 * `connected` attempt) but made no GitHub source, because GitHub's login
 * waits for repositories to be picked — so every agent still read GitHub as
 * missing, and nothing said the install could never reach the client's repo.
 *
 * Now the callback finishes it:
 *
 *   - the installation's repositories become the team's GitHub source, the
 *     row agents read (`finishGithubInstall`);
 *   - each Project whose GitHub publish target names a repository the install
 *     does not cover gets one clear card in the conversation the install came
 *     from: "<repo> is in <org>, which this install doesn't cover", with
 *     Install on <org> (an owner of it) or a request to its owner, which is
 *     GitHub's own install-request flow (`setup_action=request`);
 *   - a request comes back as a waiting state, "requested, waiting for an
 *     owner of <org>", on the card and the connector, never as connected and
 *     never as silence (`requestedSummary`, `noteRequestOnAsk`).
 *
 * A person changes the app's own permissions on GitHub; docs/guides/github.md
 * says which ones SEO needs.
 */

import type { AskOption } from '@/models/Schema';

/** A Project's GitHub publish target, as coverage reads it. */
export type GithubTargetRef = { projectId: number; projectTitle: string; repo: string };

/**
 * The owner of `owner/name`, or null.
 * @param repo - The repository.
 */
export function repoOwner(repo: string): string | null {
  const owner = repo.split('/')[0]?.trim();
  return owner || null;
}

/**
 * The targets whose repository is not among the covered ones (case aside).
 * Pure.
 * @param targets - The Projects' GitHub targets.
 * @param covered - The repositories the workspace's GitHub connection lists.
 */
export function uncoveredTargets(targets: readonly GithubTargetRef[], covered: readonly string[]): GithubTargetRef[] {
  const have = new Set(covered.map(r => r.toLowerCase()));
  return targets.filter(t => !have.has(t.repo.toLowerCase()));
}

/**
 * The waiting state of an install a person asked an owner to approve. Pure.
 * @param org - The organization, when it is known.
 */
export function requestedSummary(org: string | null): string {
  return `Install requested: waiting for an owner of ${org ?? 'the GitHub organization'} to approve it`;
}

/**
 * The card for a repository this install does not cover. Pure.
 * @param input - What is not covered and how to fix it.
 * @param input.repo - The Project's repository.
 * @param input.account - The account the install is on.
 * @param input.projectTitle - The Project.
 * @param input.startHref - The GitHub install start, back to this conversation.
 */
export function coverageAsk(input: { repo: string; account: string | null; projectTitle: string; startHref: string }): { question: string; body: string; options: AskOption[] } {
  const org = repoOwner(input.repo) ?? 'its organization';
  return {
    question: `${input.repo} is in ${org}, which this install doesn't cover`,
    body: `${input.projectTitle}'s site publishes to ${input.repo}, but GitHub was installed on ${input.account ?? 'another account'}. Install on ${org} (needs an owner of ${org}), or send the owner a request.`.slice(0, 600),
    options: [
      { id: 'install:github', label: `Install on ${org}`, description: `Opens GitHub: choose ${org}. Needs an owner of ${org}.`, recommended: true, href: input.startHref },
      { id: 'request:github', label: `Ask an owner of ${org}`, description: `Opens GitHub: choose ${org} and press Request. It shows here as waiting until an owner approves.`, href: input.startHref },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* What the workspace has                                                */
/* ------------------------------------------------------------------ */

/**
 * Every Project's GitHub publish targets.
 * @param orgId - The workspace.
 */
export async function githubTargets(orgId: string): Promise<GithubTargetRef[]> {
  const { listDataRooms } = await import('@/services/DataRoomService');
  const rooms = await listDataRooms(orgId);
  return rooms.flatMap(room => (room.meta.publishTargets ?? [])
    .filter(t => t.kind === 'github' && typeof t.config?.repo === 'string' && t.config.repo.trim())
    .map(t => ({ projectId: room.id, projectTitle: room.title, repo: String(t.config!.repo).trim() })));
}

/**
 * The repositories the GitHub connections a Project's work may use list
 * (the workspace's and that Project's own, `connectionScope.ts`): what its
 * agents and its publishing can reach. No Project: the workspace's only.
 * @param orgId - The workspace.
 * @param projectId - The Project, or null.
 */
export async function connectedGithubRepos(orgId: string, projectId: number | null = null): Promise<string[]> {
  const [{ connectionsFor }, { isGithubSource }] = await Promise.all([import('./connectionScope'), import('@/services/agents/tools/githubPullRead')]);
  const rows = (await connectionsFor(orgId, { projectId })).map(row => ({ slug: row.slug, config: row.configJson })).filter(isGithubSource);
  return [...new Set(rows.flatMap((row) => {
    const repos = (row.config as { repos?: unknown } | null)?.repos;
    return Array.isArray(repos) ? repos.filter((r): r is string => typeof r === 'string') : [];
  }))];
}

/**
 * The targets no GitHub connection in their own Project's scope covers.
 * @param orgId - The workspace.
 * @param targets - The Projects' GitHub targets.
 */
async function uncoveredInScope(orgId: string, targets: readonly GithubTargetRef[]): Promise<GithubTargetRef[]> {
  const projects = [...new Set(targets.map(t => t.projectId))];
  const covered = new Map(await Promise.all(projects.map(async id => [id, await connectedGithubRepos(orgId, id)] as const)));
  return targets.filter(t => uncoveredTargets([t], covered.get(t.projectId) ?? []).length > 0);
}

/**
 * The Project a conversation's GitHub connect ask is about (its `data_room`
 * ref, set at a publish step), newest first.
 * @param orgId - The workspace.
 * @param conversationId - The conversation.
 */
async function projectAskedFor(orgId: string, conversationId: number): Promise<number | null> {
  const [{ db }, { askSchema }, { and, desc, eq }, { connectorsOfAsk }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm'), import('./connectAskGate')]);
  const rows = await db
    .select({ options: askSchema.options, objectRefs: askSchema.objectRefs })
    .from(askSchema)
    .where(and(eq(askSchema.orgId, orgId), eq(askSchema.conversationId, conversationId), eq(askSchema.kind, 'setup')))
    .orderBy(desc(askSchema.id))
    .limit(20);
  for (const row of rows) {
    const ref = connectorsOfAsk(row.options ?? []).includes('github') ? (row.objectRefs ?? []).find(r => r.type === 'data_room') : undefined;
    if (ref && Number.isInteger(Number(ref.id))) {
      return Number(ref.id);
    }
  }
  return null;
}

/**
 * The organization an install request is waiting on: the owner of the
 * repository the conversation's publish step was for, else the one owner of
 * every GitHub target the connection does not reach yet. Null when it cannot
 * be told.
 * @param orgId - The workspace.
 * @param conversationId - The conversation the request came from, when it did.
 */
export async function requestedOrg(orgId: string, conversationId?: number): Promise<string | null> {
  try {
    const targets = await githubTargets(orgId);
    const projectId = conversationId !== undefined ? await projectAskedFor(orgId, conversationId) : null;
    const pool = await uncoveredInScope(orgId, projectId !== null ? targets.filter(t => t.projectId === projectId) : targets);
    const owners = [...new Set(pool.map(t => repoOwner(t.repo)).filter((o): o is string => Boolean(o)))];
    return owners.length === 1 ? owners[0]! : null;
  } catch {
    return null;
  }
}

/**
 * Put the waiting state on the conversation's open GitHub connect ask, so the
 * card says it rather than "did not connect". Never throws.
 * @param orgId - The workspace.
 * @param conversationId - The conversation.
 * @param summary - The waiting state.
 */
export async function noteRequestOnAsk(orgId: string, conversationId: number, summary: string): Promise<void> {
  try {
    const [{ db }, { askSchema }, { and, eq }, { connectorsOfAsk }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm'), import('./connectAskGate')]);
    const open = await db
      .select({ id: askSchema.id, options: askSchema.options })
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), eq(askSchema.conversationId, conversationId), eq(askSchema.kind, 'setup'), eq(askSchema.status, 'open')));
    const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date());
    for (const row of open.filter(r => connectorsOfAsk(r.options ?? []).includes('github'))) {
      await db.update(askSchema).set({ body: `${summary} (requested ${day}). Once they approve, connect again here to pick it up.`, updatedAt: new Date() }).where(and(eq(askSchema.orgId, orgId), eq(askSchema.id, row.id)));
    }
  } catch (error) {
    console.warn('githubInstall: could not put the request on the card', { orgId, conversationId, message: (error as Error).message });
  }
}

/* ------------------------------------------------------------------ */
/* The callback's last step                                             */
/* ------------------------------------------------------------------ */

export type FinishedInstall = {
  /** The source agents read was made or given the install's repositories. */
  sourceSaved: boolean;
  /** Why it was not, in a sentence, when it should have been. */
  failed?: string;
  /** The Projects whose repository this install does not cover. */
  uncovered: GithubTargetRef[];
};

/**
 * Finish a GitHub install the callback stored: make the team's GitHub source
 * from the installation's repositories (added to the one that exists), then
 * check every Project's GitHub target against what the connection now
 * covers, and raise the coverage card in the conversation the install came
 * from. Never throws: the login stands whatever happens here.
 * @param input - The finished install.
 * @param input.orgId - The workspace.
 * @param input.userId - The admin who installed it.
 * @param input.credentials - What the provider stored: installationId, account, repositories.
 * @param input.conversationId - The conversation the install came from, when it did.
 * @param input.projectId - The Project the connect started for, when it did: the connection is its.
 * @param input.startHref - Where Install on <org> starts, for the card.
 */
export async function finishGithubInstall(input: { orgId: string; userId: string; credentials: Record<string, unknown>; conversationId?: number; projectId?: number; startHref: string }): Promise<FinishedInstall> {
  const repos = Array.isArray(input.credentials.repositories) ? input.credentials.repositories.filter((r): r is string => typeof r === 'string' && r.includes('/')) : [];
  const account = typeof input.credentials.account === 'string' ? input.credentials.account : null;
  let sourceSaved = false;
  let failed: string | undefined;
  if (repos.length > 0) {
    try {
      const { createSourceOnLogin } = await import('./createSourceOnLogin');
      // Started for a Project ("Connect for this project", #1505): the connection is that Project's.
      const saved = await createSourceOnLogin({ orgId: input.orgId, actorUserId: input.userId, connector: 'github', config: { repos }, ...(input.projectId ? { projectId: input.projectId } : {}) });
      sourceSaved = saved.ok;
      failed = saved.ok ? undefined : saved.reason;
    } catch (error) {
      failed = (error as Error).message;
    }
  }
  let uncovered: GithubTargetRef[] = [];
  try {
    const targets = await githubTargets(input.orgId);
    const projectId = input.projectId ?? (input.conversationId !== undefined ? await projectAskedFor(input.orgId, input.conversationId) : null);
    uncovered = await uncoveredInScope(input.orgId, projectId !== null ? targets.filter(t => t.projectId === projectId) : targets);
  } catch (error) {
    console.warn('githubInstall: could not read the projects\' targets', { orgId: input.orgId, message: (error as Error).message });
  }
  if (input.conversationId !== undefined && uncovered.length > 0) {
    // One card: the first Project's repository. Another shows once this one is settled.
    const first = uncovered[0]!;
    await raiseCoverageAsk({ orgId: input.orgId, userId: input.userId, conversationId: input.conversationId, target: first, account, startHref: input.startHref });
  }
  return { sourceSaved, ...(failed ? { failed } : {}), uncovered };
}

/**
 * Raise the coverage card in a conversation. Never throws.
 * @param input - Where, what, and how to fix it.
 * @param input.orgId - The workspace.
 * @param input.userId - The person it waits on.
 * @param input.conversationId - The conversation.
 * @param input.target - The Project's target the install does not cover.
 * @param input.account - The account the install is on.
 * @param input.startHref - Where Install on <org> starts.
 * @param input.agentSlug - The agent asking, when one is.
 */
export async function raiseCoverageAsk(input: { orgId: string; userId: string; conversationId: number; target: GithubTargetRef; account: string | null; startHref: string; agentSlug?: string | null }) {
  try {
    const { raiseDecision } = await import('@/services/decisions/DecisionService');
    const ask = coverageAsk({ repo: input.target.repo, account: input.account, projectTitle: input.target.projectTitle, startHref: input.startHref });
    const { view } = await raiseDecision({
      orgId: input.orgId,
      conversationId: input.conversationId,
      ownerUserId: input.userId,
      agentSlug: input.agentSlug ?? null,
      kind: 'setup',
      question: ask.question,
      body: ask.body,
      options: ask.options,
      allowOther: true,
      objectRefs: [{ type: 'data_room', id: String(input.target.projectId) }],
    });
    return view;
  } catch (error) {
    console.warn('githubInstall: could not raise the coverage card', { orgId: input.orgId, message: (error as Error).message });
    return null;
  }
}

/**
 * At a publish step for a Project whose GitHub repository the connection does
 * not cover, while GitHub IS connected (on another account): raise the
 * coverage card here and say what it is. Null when the repository is covered
 * or there is nobody here to ask.
 * @param ctx - The turn.
 * @param ctx.orgId - The workspace.
 * @param ctx.userId - The person.
 * @param ctx.conversationId - The conversation.
 * @param ctx.agentSlug - The agent asking.
 * @param ctx.emit - Where the Decision goes.
 * @param projectId - The Project being published.
 */
export async function coverageCardAtPublish(ctx: { orgId: string; userId?: string; conversationId?: number; agentSlug?: string; emit: (event: never) => void }, projectId: number): Promise<string | null> {
  if (!ctx.userId || !ctx.conversationId || ctx.userId.startsWith('token:')) {
    return null;
  }
  const target = (await uncoveredInScope(ctx.orgId, (await githubTargets(ctx.orgId)).filter(t => t.projectId === projectId)))[0];
  if (!target) {
    return null;
  }
  const { newestLiveCredential } = await import('./createSourceOnLogin');
  const { connectStartHref } = await import('@/libs/connect/returnTo');
  const account = (await newestLiveCredential(ctx.orgId, 'github').catch(() => null))?.account ?? null;
  const view = await raiseCoverageAsk({
    orgId: ctx.orgId,
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    target,
    account,
    agentSlug: ctx.agentSlug ?? null,
    startHref: connectStartHref({ provider: 'github', connector: 'github', returnTo: `/dashboard/chat?conversation=${ctx.conversationId}`, conversationId: ctx.conversationId, projectId }),
  });
  if (!view) {
    return null;
  }
  ctx.emit({ type: 'decision', decision: view } as never);
  return `GitHub is connected, but ${target.repo} is in ${repoOwner(target.repo)}, which the install (on ${account ?? 'another account'}) does not cover. The card asks them to install on ${repoOwner(target.repo)} or send an owner a request. Say that in one line; the page stays approved until it is covered.`;
}

/** The most repositories a repo picker offers; the rest are typed. */
export const REPO_PICKER_MAX = 7;

/**
 * "Which repo is <client>'s site?" with the connection's repositories as
 * options, those named like the client first. Pure.
 * @param client - The Project's name.
 * @param repos - The repositories the GitHub connection covers.
 */
export function repoPickerAsk(client: string, repos: readonly string[]): { question: string; body: string; options: AskOption[] } {
  const words = client.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  const score = (repo: string) => words.filter(w => repo.toLowerCase().includes(w)).length;
  const ranked = [...new Set(repos)].sort((a, b) => score(b) - score(a) || a.localeCompare(b)).slice(0, REPO_PICKER_MAX);
  const best = ranked[0] && score(ranked[0]) > 0 ? ranked[0] : null;
  return {
    question: `Which repo is ${client}'s site?`.slice(0, 200),
    body: `Pages publish there as pull requests. I'll read two or three of its posts to match their frontmatter, and you apply it under Publishing on the project.${repos.length > ranked.length ? ` Showing ${ranked.length} of ${repos.length}; type another if it's not here.` : ''}`,
    options: ranked.map(repo => ({ id: `repo:${repo}`, label: repo, ...(repo === best ? { recommended: true } : {}) })),
  };
}
