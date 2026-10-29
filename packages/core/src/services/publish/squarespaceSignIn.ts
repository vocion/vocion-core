/**
 * THE SQUARESPACE SIGN-IN A PUBLISH RUN STARTS FROM. Squarespace has no API
 * for posts, so publishing signs in to the site's editor in a browser run
 * (`squarespaceTask.ts`), and Squarespace refuses a password typed from a
 * data centre: on Vocion Cloud the browser container was told "The username
 * or password is incorrect" for a login that worked from a laptop, while the
 * laptop's session cookies opened the editor from that same container. So a
 * publish run starts from the sign-in kept on the site's Squarespace
 * connector (`services/browser/keptSignIn.ts`), tries the stored password
 * once only when there is none or it has expired, and when Squarespace still
 * will not sign it in, the page waits on a person signing in again (never a
 * failure), and carries on by itself once they have.
 */

import type { RunOwner } from './sitePublish';
import type { KeptSignInStatus } from '@/libs/browser/keptSignIn';
import type { BrowserRunView } from '@/libs/browser/run';
import type { RunSignIn } from '@/services/browser/keptSignIn';
import { httpHostOf, keptSignInSpecFor } from '@/libs/browser/keptSignIn';

/** The connector slug a Squarespace site's connection runs. */
const CONNECTOR = 'squarespace';

/** Where Squarespace signs a person in: a run that ended on it ended signed out. */
export const SQUARESPACE_LOGIN_HOST = 'login.squarespace.com';

/** The `sign_in` output a publish run gives when Squarespace would not sign its browser in. */
export const SIGN_IN_REFUSED = 'refused';

/**
 * A site's host as compared: lower case, no `www.`.
 * @param url - The site's address.
 */
export function siteHostOf(url: string): string | null {
  return httpHostOf(url)?.replace(/^www\./, '') ?? null;
}

/**
 * Whether a page is a site's editor, signed in: a Squarespace address under
 * `/config` that is not the login page. What the operator's CLI waits for
 * before it saves the session (`scripts/squarespace-session.ts`).
 * @param url - The page's address.
 */
export function editorSignedIn(url: string): boolean {
  const host = httpHostOf(url);
  if (!host || host === SQUARESPACE_LOGIN_HOST || !(host === 'squarespace.com' || host.endsWith('.squarespace.com'))) {
    return false;
  }
  return new URL(url).pathname.startsWith('/config');
}

/** The Squarespace connector of one site, and its kept sign-in. */
export type SquarespaceConnection = { sourceId: number; slug: string; siteUrl: string; signIn: KeptSignInStatus };

/**
 * The workspace's Squarespace connector for a site, by the site's host, or
 * null when it has none (a project may name a site no connector reads).
 * @param orgId - The workspace.
 * @param siteUrl - The site.
 */
export async function squarespaceConnectionFor(orgId: string, siteUrl: string): Promise<SquarespaceConnection | null> {
  const want = siteHostOf(siteUrl);
  if (!want) {
    return null;
  }
  const { eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { knowledgeSourceSchema } = await import('@/models/Schema');
  const { statusOf } = await import('@/services/browser/keptSignIn');
  const rows = await db.select({ id: knowledgeSourceSchema.id, slug: knowledgeSourceSchema.slug, config: knowledgeSourceSchema.configJson, keptSignIn: knowledgeSourceSchema.keptSignIn })
    .from(knowledgeSourceSchema)
    .where(eq(knowledgeSourceSchema.orgId, orgId))
    .orderBy(knowledgeSourceSchema.id);
  for (const row of rows) {
    const connector = (row.config?._connector as string | undefined) ?? row.slug;
    const site = typeof row.config?.siteUrl === 'string' ? row.config.siteUrl : null;
    if (connector === CONNECTOR && site && siteHostOf(site) === want) {
      return { sourceId: row.id, slug: row.slug, siteUrl: site, signIn: statusOf(row.keptSignIn) };
    }
  }
  return null;
}

/**
 * What a publish run carries to start from the connector's kept sign-in and save it back.
 * @param connection - The site's connector.
 */
export function runSignInOf(connection: SquarespaceConnection | null): RunSignIn | null {
  const spec = keptSignInSpecFor(CONNECTOR);
  return connection && spec ? { sourceId: connection.sourceId, vendor: spec.vendor, domains: spec.domains } : null;
}

/**
 * Whether a publish run ended because Squarespace would not sign it in: it
 * said so in its typed output (`sign_in: refused`), or its last page was
 * Squarespace's sign-in page. Read from the run, never from its words.
 * @param run - The ended run.
 */
export function needsFreshSignIn(run: Pick<BrowserRunView, 'status' | 'result' | 'steps' | 'url'>): boolean {
  if (run.status !== 'failed') {
    return false;
  }
  const said = typeof run.result?.sign_in === 'string' && run.result.sign_in.trim().toLowerCase() === SIGN_IN_REFUSED;
  const lastUrl = run.url ?? [...(run.steps ?? [])].reverse().find(s => s.url)?.url ?? null;
  return said || (lastUrl ? httpHostOf(lastUrl) === SQUARESPACE_LOGIN_HOST : false);
}

/**
 * The outcome a page shows while it waits on a person signing in again.
 * @param siteUrl - The site.
 * @param connected - Whether the workspace has a Squarespace connector for it.
 */
export function freshSignInLine(siteUrl: string, connected: boolean): string {
  const host = siteHostOf(siteUrl) ?? siteUrl;
  return connected
    ? `Squarespace needs a fresh sign-in for ${host}. Publishing waits for it: an admin signs in once (Connectors → Squarespace → Sign in again) and it carries on by itself.`
    : `Squarespace needs a fresh sign-in for ${host}. Publishing waits for it: connect the site under Connectors → Squarespace, sign in once, and it carries on by itself.`;
}

/** What a page waiting on a sign-in keeps, so it can carry on once there is one. */
export type WaitingOnSignIn = {
  waitingOn: 'sign-in';
  site: string;
  signInSourceId: number | null;
  phase: 'draft' | 'live';
  owner: RunOwner;
  actionRunId: number | null;
  /** The post, for going live again. */
  post?: { siteUrl: string; blogPath: string; slug: string; title: string };
};

/**
 * Carry on every publish that was waiting on a fresh sign-in for this site,
 * now that there is one: the draft or going-live run starts again, as the
 * person who approved it, under the same approval. Never throws; a page that
 * cannot carry on keeps waiting and says why.
 * @param orgId - The workspace.
 * @param connection - The connector that was just signed in.
 * @param connection.sourceId - Its row.
 * @param connection.siteUrl - Its site.
 */
export async function resumeWaitingOnSignIn(orgId: string, connection: { sourceId: number; siteUrl: string }): Promise<number[]> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const host = siteHostOf(connection.siteUrl);
  const rows = await db.select({ id: businessObjectSchema.id, meta: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), sql`${businessObjectSchema.metadata} -> 'publishing' ->> 'waitingOn' = 'sign-in'`))
    .catch(() => []);
  const resumed: number[] = [];
  for (const row of rows) {
    const waiting = (row.meta as Record<string, unknown> | null)?.publishing as WaitingOnSignIn | undefined;
    if (!waiting || (waiting.signInSourceId !== connection.sourceId && siteHostOf(waiting.site) !== host)) {
      continue;
    }
    const ok = await resumeOne(orgId, row.id, waiting).catch((e: Error) => {
      console.warn('[publish] a page waiting on a sign-in could not carry on', { page: row.id, reason: e.message });
      return false;
    });
    if (ok) {
      resumed.push(row.id);
    }
  }
  return resumed;
}

async function resumeOne(orgId: string, pageRecordId: number, waiting: WaitingOnSignIn): Promise<boolean> {
  const { planPublish, recordOnPage, squarespaceLogin, startSquarespaceDraft, startSquarespaceLive } = await import('./sitePublish');
  const at = new Date().toISOString();
  if (waiting.phase === 'live') {
    if (!waiting.post) {
      return false;
    }
    await startSquarespaceLive(orgId, [{ pageRecordId, ...waiting.post, actionRunId: waiting.actionRunId }], waiting.owner);
    return true;
  }
  const planned = await planPublish(orgId, { pageRecordId });
  if (!planned.ok || planned.plan.target.kind !== 'squarespace') {
    await recordOnPage(orgId, pageRecordId, { publishing: { ...waiting, at, note: `Signed in again, but the page cannot carry on: ${planned.ok ? 'its target is not Squarespace any more' : planned.why}` } });
    return false;
  }
  const started = await startSquarespaceDraft(orgId, planned.plan, await squarespaceLogin(orgId), waiting.owner, waiting.actionRunId);
  await recordOnPage(orgId, pageRecordId, { status: 'publishing', publishing: { kind: 'squarespace', phase: 'draft', targetId: planned.plan.target.id, browserRunId: started.browserRunId, href: `/dashboard/browser/${started.browserRunId}`, at, by: waiting.owner.userId, actionRunId: waiting.actionRunId, note: started.queued ? 'Signed in again: the draft waits its turn in your browser.' : 'Signed in again: saving the draft.' } });
  return true;
}
