/**
 * Search Console for a client's work: the workspace's Search Console login,
 * and which property each client Project reads.
 *
 * The login is the workspace's (the `search-console` connector, a Google
 * login with `webmasters.readonly`). The PROPERTY is the Project's: an
 * agency's one login reads every client's property, so each client project
 * holds the one a person picked for it (`searchConsoleProperty` on the
 * project, with when and by whom). Until connectors can belong to a single
 * project (#1505), this is how one client's work never reads another's site.
 *
 * Every part is reached lazily from the tools (`await import`), so nothing
 * here weighs on the tool registry.
 */

import type { SearchConsoleSite } from '@/libs/searchConsole/client';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';

export const SEARCH_CONSOLE_KIND = 'search-console';

/** The words for a workspace with no Search Console login. */
export const SEARCH_CONSOLE_NOT_CONNECTED = 'Google Search Console is not connected in this workspace. Connecting it is one Google sign-in and free: it shows what the client\'s site already ranks for, with real clicks and impressions. Say it is not connected; do not estimate rankings or traffic.';

export type SearchConsoleAccess
  = | { ok: true; accessToken: string; defaultSite: string | null }
    | { ok: false; reason: string };

/**
 * An access token for the workspace's Search Console login, or the reason
 * there is none, in words.
 * @param orgId - The workspace.
 */
export async function searchConsoleAccess(orgId: string): Promise<SearchConsoleAccess> {
  const rows = await db
    .select({ id: knowledgeSourceSchema.id, slug: knowledgeSourceSchema.slug, kind: knowledgeSourceSchema.kind, config: knowledgeSourceSchema.configJson, enabled: knowledgeSourceSchema.enabled, apiTokenId: knowledgeSourceSchema.apiTokenId })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.enabled, 'true')));
  const source = rows
    .map(r => ({ ...r, kind: (r.config as { _connector?: unknown } | null)?._connector === SEARCH_CONSOLE_KIND ? SEARCH_CONSOLE_KIND : r.kind, config: (r.config ?? {}) as Record<string, unknown> }))
    .find(r => r.kind === SEARCH_CONSOLE_KIND);
  if (!source) {
    return { ok: false, reason: SEARCH_CONSOLE_NOT_CONNECTED };
  }
  const [{ familySourceCredentials }, { resolveGoogleAccessToken }] = await Promise.all([
    import('@/services/connectors/familyCredentials'),
    import('@/libs/sources/googleAuth'),
  ]);
  try {
    const bag = await familySourceCredentials(orgId, { id: source.id, slug: source.slug, kind: source.kind, config: source.config, apiTokenId: source.apiTokenId ?? null });
    if (!bag) {
      return { ok: false, reason: 'The Search Console connection has no Google login stored. Reconnect Search Console (one Google sign-in).' };
    }
    const accessToken = await resolveGoogleAccessToken(bag, orgId);
    const site = typeof source.config.siteUrl === 'string' && source.config.siteUrl.trim() ? source.config.siteUrl.trim() : null;
    return { ok: true, accessToken, defaultSite: site };
  } catch (err) {
    return { ok: false, reason: `The Search Console login could not be used: ${(err as Error).message} Reconnect Search Console.` };
  }
}

/**
 * The properties the workspace's login can read, for the connector form's
 * dropdown and the agent's question. Empty with the reason when it cannot.
 * @param orgId - The workspace.
 */
export async function searchConsoleSites(orgId: string): Promise<{ sites: SearchConsoleSite[]; reason?: string }> {
  const access = await searchConsoleAccess(orgId);
  if (!access.ok) {
    return { sites: [], reason: access.reason };
  }
  const { listSearchConsoleSites } = await import('@/libs/searchConsole/client');
  try {
    const sites = await listSearchConsoleSites(access.accessToken);
    return sites.length ? { sites } : { sites, reason: 'This Google login has no verified Search Console property. Add the person\'s Google account to the client\'s property in Search Console (Settings → Users and permissions), then reconnect.' };
  } catch (err) {
    return { sites: [], reason: (err as Error).message };
  }
}

/**
 * The property a project reads, or null when none was picked.
 * @param orgId - The workspace.
 * @param projectId - The client project.
 */
export async function projectSearchConsoleProperty(orgId: string, projectId: number): Promise<{ siteUrl: string; setAt: string } | null | 'no-project'> {
  const { getProject } = await import('@/services/DataRoomService');
  const project = await getProject(orgId, projectId);
  if (!project) {
    return 'no-project';
  }
  const held = (project.meta as { searchConsoleProperty?: { siteUrl?: unknown; setAt?: unknown } }).searchConsoleProperty;
  return held && typeof held.siteUrl === 'string' && held.siteUrl ? { siteUrl: held.siteUrl, setAt: String(held.setAt ?? '') } : null;
}

/**
 * Keep the property a person picked for a project.
 * @param orgId - The workspace.
 * @param projectId - The client project.
 * @param siteUrl - The property.
 * @param by - Who picked it.
 */
export async function setProjectSearchConsoleProperty(orgId: string, projectId: number, siteUrl: string, by: string | null): Promise<boolean> {
  const { updateDataRoom } = await import('@/services/DataRoomService');
  const room = await updateDataRoom(orgId, projectId, { searchConsoleProperty: { siteUrl, setAt: new Date().toISOString(), setBy: by } });
  return room !== null;
}
