/**
 * Test connection for the Microsoft 365 connectors: who the login is, and one
 * cheap read of what the connector syncs, so "it connected" and "it can read
 * the mail" are two separate, visible answers. Nothing is saved, except an
 * expiring login renewed for a connected source (`testConnectionPersistence`).
 */

import type { ConnectorCheck, ConnectorInspection, InspectInput } from '@/libs/sources/inspect';
import { isLoginGrant, renewedLoginNote, testConnectionPersistence } from '@/libs/connect/loginGrant';
import { InspectInputError } from '@/libs/sources/inspect';
import { GRAPH_BASE, GraphError, graphJson, resolveGraphToken } from './graph';

/** One cheap read per connector: what it proves, and the path that proves it. */
export type MicrosoftProbe = {
  label: string;
  /** The read, given the source's settings; returns what was observed. */
  run: (token: string, config: Record<string, unknown>, baseUrl: string) => Promise<string>;
};

/**
 * The Graph base a source's settings name, or Graph's own.
 * @param config - The source's settings.
 */
function baseUrlOf(config: Record<string, unknown>): string {
  return typeof config.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl.trim() : GRAPH_BASE;
}

/**
 * Inspect a Microsoft 365 connector's credential.
 * @param connectorSlug - The connector being tested.
 * @param probe - The connector's own cheap read.
 * @param input - What the Test connection route received.
 */
export async function inspectMicrosoft(connectorSlug: string, probe: MicrosoftProbe, input: InspectInput): Promise<ConnectorInspection> {
  let token: string;
  try {
    token = await resolveGraphToken(input.credentials, testConnectionPersistence(connectorSlug, input.savedSource), connectorSlug);
  } catch (error) {
    throw new InspectInputError(error instanceof Error ? error.message : 'The Microsoft login could not be used.');
  }
  const baseUrl = baseUrlOf(input.config);
  const checks: ConnectorCheck[] = [];
  let reachable = false;
  let authorized = false;
  try {
    const me = await graphJson<{ displayName?: string; mail?: string | null; userPrincipalName?: string }>(token, { path: '/me?$select=displayName,mail,userPrincipalName', what: 'who this login is', baseUrl });
    reachable = true;
    authorized = true;
    checks.push({ key: 'identity', label: 'Microsoft login', ok: true, detail: me.mail ?? me.userPrincipalName ?? me.displayName ?? null });
  } catch (error) {
    reachable = error instanceof GraphError && error.status !== 0;
    checks.push({ key: 'identity', label: 'Microsoft login', ok: false, detail: error instanceof Error ? error.message : null });
    return { reachable, authorized: false, checks, note: null, error: error instanceof Error ? error.message : 'Microsoft 365 could not be reached.' };
  }
  try {
    const detail = await probe.run(token, input.config, baseUrl);
    checks.push({ key: 'read', label: probe.label, ok: true, detail });
  } catch (error) {
    checks.push({ key: 'read', label: probe.label, ok: false, detail: error instanceof Error ? error.message : null });
  }
  const renewed = isLoginGrant(input.credentials) && token !== input.credentials.accessToken;
  return { reachable, authorized, checks, note: renewed ? renewedLoginNote('Microsoft') : null, error: null };
}
