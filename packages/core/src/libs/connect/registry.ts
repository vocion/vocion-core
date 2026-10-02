/**
 * The vendors a person can connect a source to with a click, instead of
 * pasting a key. One descriptor per vendor; the routes under
 * `app/api/connect/[provider]` and the connect dialog read only this list.
 */

import type { ConnectProvider } from './provider';
import { atlassianProvider } from './providers/atlassian';
import { githubProvider } from './providers/github';
import { slackProvider } from './providers/slack';
import { connectScriptEnabled, scriptedProviders } from './scripted';

const realProviders: readonly ConnectProvider[] = [slackProvider, atlassianProvider, githubProvider];

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
 * draw the button or say what the server is missing, never an env value.
 * @param connectorSlug - A source's connector slug.
 */
export function connectOptionFor(connectorSlug: string): {
  provider: ConnectProvider['id'];
  label: string;
  configured: boolean;
  requiredEnv: readonly string[];
} | null {
  const provider = providerForConnector(connectorSlug);
  if (!provider) {
    return null;
  }
  return {
    provider: provider.id,
    label: provider.label,
    configured: provider.configured(),
    requiredEnv: provider.requiredEnv,
  };
}
