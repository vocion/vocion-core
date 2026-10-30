/**
 * Search Console for a client's work: the workspace's Search Console login,
 * and which property each client Project reads.
 *
 * The login is a `search-console` connection (a Google login with
 * `webmasters.readonly`), connected for the whole workspace or for one client
 * project (#1505); work for a project uses its own first and never another
 * project's. The PROPERTY is the project's too: an agency's one login reads
 * every client's property, so each client project holds the one a person
 * picked for it (`searchConsoleProperty` on the project, with when and by
 * whom), and one client's work never reads another's site.
 *
 * Every part is reached lazily from the tools (`await import`), so nothing
 * here weighs on the tool registry.
 */

import type { SearchConsoleSite } from '@/libs/searchConsole/client';

export const SEARCH_CONSOLE_KIND = 'search-console';

/** The words for a workspace with no Search Console login. */
export const SEARCH_CONSOLE_NOT_CONNECTED = 'Google Search Console is not connected in this workspace. Connecting it is one Google sign-in and free: it shows what the client\'s site already ranks for, with real clicks and impressions. Say it is not connected; do not estimate rankings or traffic.';

export type SearchConsoleAccess
  = | { ok: true; accessToken: string; defaultSite: string | null; projectConnection: boolean }
    | { ok: false; reason: string };

/**
 * An access token for the Search Console login this work may use, or the
 * reason there is none, in words. Read through the one connection resolver
 * (`services/connect/connectionScope.ts`): work for a project uses a login
 * connected for that project first, else the workspace's, never another
 * project's.
 * @param orgId - The workspace.
 * @param projectId - The client project the work is for; the current work's when omitted.
 */
export async function searchConsoleAccess(orgId: string, projectId?: number | null): Promise<SearchConsoleAccess> {
  const { connectionsFor, connectionsWithheld } = await import('@/services/connect/connectionScope');
  const scope = projectId === undefined ? undefined : { projectId };
  const kindOf = (r: { kind: string; configJson: unknown }) => ((r.configJson as { _connector?: unknown } | null)?._connector === SEARCH_CONSOLE_KIND ? SEARCH_CONSOLE_KIND : r.kind);
  const rows = (await connectionsFor(orgId, scope)).filter(r => kindOf(r) === SEARCH_CONSOLE_KIND);
  // The project's own login before the workspace's.
  const source = rows.find(r => r.dataRoomId !== null) ?? rows[0];
  if (!source) {
    const withheld = (await connectionsWithheld(orgId, scope)).find(r => kindOf(r) === SEARCH_CONSOLE_KIND);
    return { ok: false, reason: withheld ? `Google Search Console is connected for project ${withheld.projectTitle}, not for this work. Connect it for this client's project (one Google sign-in, free).` : SEARCH_CONSOLE_NOT_CONNECTED };
  }
  const config = (source.configJson ?? {}) as Record<string, unknown>;
  const [{ familySourceCredentials }, { resolveGoogleAccessToken }] = await Promise.all([
    import('@/services/connectors/familyCredentials'),
    import('@/libs/sources/googleAuth'),
  ]);
  try {
    const bag = await familySourceCredentials(orgId, { id: source.id, slug: source.slug, kind: SEARCH_CONSOLE_KIND, config, apiTokenId: source.apiTokenId ?? null });
    if (!bag) {
      return { ok: false, reason: 'The Search Console connection has no Google login stored. Reconnect Search Console (one Google sign-in).' };
    }
    const accessToken = await resolveGoogleAccessToken(bag, orgId);
    const site = typeof config.siteUrl === 'string' && config.siteUrl.trim() ? config.siteUrl.trim() : null;
    return { ok: true, accessToken, defaultSite: site, projectConnection: source.dataRoomId !== null };
  } catch (err) {
    return { ok: false, reason: `The Search Console login could not be used: ${(err as Error).message} Reconnect Search Console.` };
  }
}

/**
 * The properties the workspace's login can read, for the connector form's
 * dropdown and the agent's question. Empty with the reason when it cannot.
 * @param orgId - The workspace.
 * @param projectId - The client project; the current work's when omitted.
 */
export async function searchConsoleSites(orgId: string, projectId?: number | null): Promise<{ sites: SearchConsoleSite[]; reason?: string }> {
  const access = await searchConsoleAccess(orgId, projectId);
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
