/**
 * CONNECTING GITHUB FROM CONNECTIONS (backlog 053) — the two browser round
 * trips, each a start and a callback, written as plain functions the route
 * files call so every branch is testable without a browser.
 *
 *   Create the app (once per deployment):
 *     startManifest   → a page that posts the manifest to github.com
 *     finishManifest  → the code traded for the app's credentials, sealed
 *
 *   Connect a workspace (once per GitHub account):
 *     startInstall    → GitHub's install screen (account, repositories)
 *     finishInstall   → the person proven to reach the installation through
 *                       a GitHub sign-in, then the installation bound
 *
 * Every outcome is a redirect back to Connections carrying what happened, so
 * a failure is read where the person is looking, in GitHub's own words.
 */

import type { ApiCaller } from '@/services/writeApi';
import { appUrls, buildAppManifest, convertManifest, GITHUB_WEB_URL, installationsThePersonCanReach, manifestPostUrl, userAuthorizeUrl } from '@/libs/github/appManifest';
import { signGithubAppState, verifyGithubAppState } from '@/libs/github/appState';

/** Where the person lands after either round trip. */
export const CONNECTIONS_PATH = '/dashboard/connectors';

export type FlowOutcome = { redirect: string } | { html: string };

type Deps = {
  fetchImpl?: typeof fetch;
};

function back(origin: string, params: Record<string, string>, path = CONNECTIONS_PATH): { redirect: string } {
  const u = new URL(path.startsWith('/') ? path : CONNECTIONS_PATH, origin);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return { redirect: u.toString() };
}

/**
 * Only an app-relative path is a place to return to.
 * @param path
 */
function safeReturn(path: string | null | undefined): string | undefined {
  return path && path.startsWith('/') && !path.startsWith('//') ? path : undefined;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The page that hands the manifest to GitHub. GitHub only takes a manifest as
 * a form POST, so this is a form that submits itself, with its button left
 * visible for a browser that blocks the script.
 * @param input - Who is creating it, and for which GitHub owner.
 * @param input.caller - The signed-in person.
 * @param input.origin - The deployment's public origin.
 * @param input.org - The GitHub organization that will own the app; the person's own account when empty.
 * @param input.name - The app's name; "Vocion <host>" when empty.
 */
export function startManifest(input: { caller: ApiCaller; origin: string; org?: string | null; name?: string | null }): { html: string } {
  const state = signGithubAppState({ purpose: 'manifest', orgId: input.caller.orgId, userId: input.caller.actorId });
  const manifest = buildAppManifest({ origin: input.origin, ...(input.name ? { name: input.name } : {}) });
  const action = manifestPostUrl(state, input.org);
  return {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Create the GitHub App</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#111">
<form id="m" method="post" action="${escapeHtml(action)}">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
<p>Taking you to GitHub to create <strong>${escapeHtml(manifest.name)}</strong>${input.org ? ` for <strong>${escapeHtml(input.org)}</strong>` : ''}.</p>
<button type="submit" style="padding:.5rem 1rem;border-radius:999px;border:0;background:#111;color:#fff">Continue to GitHub</button>
</form><script>document.getElementById('m').submit()</script></body></html>`,
  };
}

/**
 * GitHub created the app: trade the code for its credentials and seal them.
 * @param input - The callback.
 * @param input.caller - The signed-in person; must be the one who started it.
 * @param input.origin - The deployment's public origin.
 * @param input.code - GitHub's one-hour code.
 * @param input.state - The state it carried.
 * @param deps - Injected for tests.
 */
export async function finishManifest(input: { caller: ApiCaller; origin: string; code: string | null; state: string | null }, deps: Deps = {}): Promise<{ redirect: string }> {
  const state = verifyGithubAppState(input.state, 'manifest');
  if (!state || state.userId !== input.caller.actorId) {
    return back(input.origin, { github: 'error', reason: 'That link to finish creating the GitHub App has expired or was started by someone else. Create it again from Connections.' });
  }
  if (!input.code) {
    return back(input.origin, { github: 'error', reason: 'GitHub did not send the new app back. Create it again from Connections.' });
  }
  const converted = await convertManifest(input.code, deps.fetchImpl);
  if (!converted.ok) {
    return back(input.origin, { github: 'error', reason: converted.message });
  }
  const a = converted.app;
  if (!a.webhook_secret) {
    return back(input.origin, { github: 'error', reason: 'GitHub created the app without a webhook secret, so its deliveries could not be verified. Delete it on GitHub and create it again from Connections.' });
  }
  const { saveApp } = await import('./GithubAppService');
  await saveApp({
    appId: a.id,
    slug: a.slug,
    name: a.name,
    clientId: a.client_id,
    ownerLogin: a.owner?.login ?? null,
    htmlUrl: a.html_url ?? null,
    permissions: a.permissions ?? {},
    events: a.events ?? [],
    secrets: { privateKey: a.pem, webhookSecret: a.webhook_secret, clientSecret: a.client_secret },
  }, input.caller.actorId);
  return back(input.origin, { github: 'created' });
}

/**
 * Send the person to GitHub's install screen for the deployment's app.
 * @param input - The start.
 * @param input.caller - The signed-in person.
 * @param input.origin - The deployment's public origin.
 * @param input.returnTo - An app-relative path to land on afterwards (a chat, a feature).
 */
export async function startInstall(input: { caller: ApiCaller; origin: string; returnTo?: string | null }): Promise<{ redirect: string }> {
  const { activeApp } = await import('./GithubAppService');
  const app = await activeApp();
  if (!app) {
    return back(input.origin, { github: 'error', reason: 'This deployment has no GitHub App yet: create it first, then connect.' });
  }
  const returnTo = safeReturn(input.returnTo);
  const state = signGithubAppState({ purpose: 'install', orgId: input.caller.orgId, userId: input.caller.actorId, ...(returnTo ? { returnTo } : {}) });
  return { redirect: `${GITHUB_WEB_URL}/apps/${encodeURIComponent(app.slug)}/installations/new?state=${encodeURIComponent(state)}` };
}

/**
 * Back from GitHub's install screen (or from the sign-in that follows it).
 *
 * First pass (no `code`): GitHub named an installation. Nothing is bound on
 * that alone — the person is sent through a GitHub sign-in as the app, with
 * the installation carried in the signed state. Second pass (`code`): the
 * installation must be one GitHub says this person can reach; then it is
 * bound to the workspace that started the flow.
 * @param input - The callback.
 * @param input.caller - The signed-in person.
 * @param input.origin - The deployment's public origin.
 * @param input.query - GitHub's query string.
 * @param input.query.installationId - `installation_id`.
 * @param input.query.setupAction - `setup_action`: install, update or request.
 * @param input.query.state - The state GitHub carried back.
 * @param input.query.code - The sign-in's code, on the second pass.
 * @param deps - Injected for tests.
 */
export async function finishInstall(
  input: { caller: ApiCaller; origin: string; query: { installationId: string | null; setupAction: string | null; state: string | null; code: string | null } },
  deps: Deps = {},
): Promise<{ redirect: string }> {
  const svc = await import('./GithubAppService');
  const app = await svc.activeApp();
  if (!app) {
    return back(input.origin, { github: 'error', reason: 'This deployment has no GitHub App yet: create it first, then connect.' });
  }
  const { caller, origin, query } = input;
  const redirectUri = appUrls(origin).installCallback;

  if (!query.code) {
    if (query.setupAction === 'request') {
      return back(origin, { github: 'requested', reason: 'GitHub sent the install request to an owner of that organization. It connects here as soon as they approve it.' });
    }
    const installationId = Number(query.installationId);
    if (!Number.isInteger(installationId) || installationId <= 0) {
      return back(origin, { github: 'error', reason: 'GitHub did not say which installation to connect. Start again with Connect on Connections.' });
    }
    // Installed straight from GitHub, with no state: this person and the
    // workspace they are in now are who connects it.
    const started = verifyGithubAppState(query.state, 'install');
    const owner = started && started.userId === caller.actorId ? started : null;
    const state = signGithubAppState({
      purpose: 'install',
      orgId: owner?.orgId ?? caller.orgId,
      userId: caller.actorId,
      installationId,
      ...(owner?.returnTo ? { returnTo: owner.returnTo } : {}),
    });
    return { redirect: userAuthorizeUrl({ clientId: app.clientId, redirectUri, state }) };
  }

  const state = verifyGithubAppState(query.state, 'install');
  if (!state || state.userId !== caller.actorId) {
    return back(origin, { github: 'error', reason: 'That GitHub connection link has expired or was started by someone else. Start again with Connect on Connections.' });
  }
  const secrets = await svc.appSecrets(app);
  const reach = await installationsThePersonCanReach({ clientId: app.clientId, clientSecret: secrets.clientSecret, code: query.code, redirectUri, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
  if (!reach.ok) {
    return back(origin, { github: 'error', reason: reach.message }, state.returnTo);
  }
  const installationId = state.installationId ?? (reach.installations.length === 1 ? reach.installations[0]!.id : null);
  if (installationId === null) {
    return back(origin, { github: 'error', reason: 'Pick the GitHub organization to connect on GitHub\'s install screen: Connect on Connections takes you there.' }, state.returnTo);
  }
  if (!reach.installations.some(i => i.id === installationId)) {
    return back(origin, { github: 'error', reason: 'Your GitHub account cannot reach that installation, so it was not connected. An owner of the organization can connect it, or add you to it.' }, state.returnTo);
  }
  const row = await svc.bindInstallation({ orgId: state.orgId, installationId, connectedBy: caller.actorId, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
  await svc.afterInstallationBound(row).catch((err: Error) => console.warn('[github-app] after-bind step failed', { orgId: row.orgId, installationId, error: err.message }));
  return back(origin, { github: 'connected', account: row.accountLogin }, state.returnTo);
}
