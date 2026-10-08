/**
 * The vendors a person can connect a source to with a click, instead of
 * pasting a key. One descriptor per vendor; the routes under
 * `app/api/connect/[provider]` and the connect dialog read only this list.
 */

import type { ConnectProvider } from './provider';
import { loginAppPlatformFor } from '@/libs/platforms/registry';
import { loginOffered } from './loginClient';
import { apolloProvider } from './providers/apollo';
import { atlassianProvider } from './providers/atlassian';
import { githubProvider } from './providers/github';
import { googleProvider } from './providers/google';
import { gustoProvider } from './providers/gusto';
import { hubspotProvider } from './providers/hubspot';
import { microsoftProvider } from './providers/microsoft';
import { notionProvider } from './providers/notion';
import { posthogProvider } from './providers/posthog';
import { quickbooksProvider } from './providers/quickbooks';
import { slackProvider } from './providers/slack';
import { xeroProvider } from './providers/xero';
import { zoomProvider } from './providers/zoom';
import { connectScriptEnabled, scriptedProviders } from './scripted';

const realProviders: readonly ConnectProvider[] = [
  slackProvider,
  atlassianProvider,
  githubProvider,
  googleProvider,
  hubspotProvider,
  notionProvider,
  zoomProvider,
  posthogProvider,
  apolloProvider,
  quickbooksProvider,
  xeroProvider,
  gustoProvider,
  microsoftProvider,
];

/**
 * Every provider, the real ones, or their scripted stand-ins when
 * `VOCION_CONNECT_SCRIPT` is set (e2e only; refused in production).
 */
export function connectProviders(): readonly ConnectProvider[] {
  return connectScriptEnabled() ? scriptedProviders(realProviders) : realProviders;
}

/**
 * The provider with this id, or null when the URL names none.
 * @param id - The `[provider]` URL segment.
 */
export function providerFor(id: string): ConnectProvider | null {
  return connectProviders().find(provider => provider.id === id) ?? null;
}

/**
 * The provider that connects this connector, or null when the connector is
 * pasted-key only.
 * @param connectorSlug - A source's connector slug, e.g. `jira`.
 */
export function providerForConnector(connectorSlug: string): ConnectProvider | null {
  return connectProviders().find(provider => provider.connectorSlugs.includes(connectorSlug)) ?? null;
}

/**
 * What the browser may know about a connector's connect option: enough to
 * draw the button or say what is missing, never an env value or a client.
 * `configured` is true when the server's env or the workspace's own login app
 * (`loginOffered`) sets the login up; `bringYourOwnApp` says whether a
 * workspace may save its own app for this vendor at all.
 * @param orgId - The workspace being shown the option.
 * @param connectorSlug - A source's connector slug.
 */
export async function connectOptionFor(orgId: string, connectorSlug: string): Promise<{
  provider: ConnectProvider['id'];
  label: string;
  configured: boolean;
  requiredEnv: readonly string[];
  bringYourOwnApp: boolean;
} | null> {
  const provider = providerForConnector(connectorSlug);
  if (!provider) {
    return null;
  }
  return {
    provider: provider.id,
    label: provider.label,
    configured: await loginOffered(orgId, provider),
    requiredEnv: provider.requiredEnv,
    bringYourOwnApp: loginAppPlatformFor(provider.id) !== null,
  };
}
