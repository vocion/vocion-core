/**
 * Zendesk connector — a Zendesk account, reached live through an OAuth client.
 *
 * Syncless: nothing is copied into Vocion. Today it carries the credential and
 * Test connection; the tools that read and write the account build on its
 * client (`libs/zendesk/client.ts`), each asking for only the OAuth scopes it
 * uses. Auth: the `zendesk` platform's subdomain, client ID and client secret.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { ZendeskCredentials, ZendeskDeps, ZendeskScope } from '@/libs/zendesk/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { getZendeskToken, zendeskCredentialsFrom, ZendeskError, zendeskRequest } from '@/libs/zendesk/client';
import { InspectInputError } from './inspect';

/** Nothing to set yet: the account is named by the credential. */
export const zendeskConfigSchema = z.object({});

/** What Test connection asks for: enough to read which user the client acts as. */
const INSPECT_SCOPES: readonly ZendeskScope[] = ['users:read'];

/** Roles whose token can work tickets. An end-user can only see their own requests. */
const STAFF_ROLES = new Set(['admin', 'agent']);

/**
 * Test connection: mint a fresh token, then read which Zendesk user it acts
 * as. Read-only. Nothing is saved in Vocion; the token is kept in memory
 * until it expires, like any other.
 * @param input - Credential values, as typed or as vaulted.
 * @param input.credentials - Subdomain, client ID and client secret.
 * @param deps - The network and clock, injected in tests.
 */
export async function inspectZendesk(input: { credentials: Record<string, unknown> }, deps?: ZendeskDeps): Promise<ConnectorInspection> {
  const parsed = zendeskCredentialsFrom(input.credentials);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const { credentials } = parsed;
  const host = `${credentials.subdomain}.zendesk.com`;
  const checks: ConnectorCheck[] = [];

  let grantedScopes: string[] | null;
  try {
    ({ grantedScopes } = await getZendeskToken(credentials, INSPECT_SCOPES, deps, { fresh: true }));
  } catch (err) {
    const message = messageOf(err);
    const status = err instanceof ZendeskError ? err.status : null;
    checks.push({ key: 'token', label: `Gets an OAuth token from ${host}`, ok: false, detail: message });
    return { reachable: status !== null, authorized: false, checks, note: null, error: message };
  }

  // Zendesk still issues a token for a scope it does not recognise, then
  // answers 403 to every call made with it, so a missing scope fails here.
  const granted = grantedScopes;
  const missingScopes = granted ? INSPECT_SCOPES.filter(scope => !granted.includes(scope)) : [];
  if (missingScopes.length > 0) {
    const message = `Zendesk issued the token without ${missingScopes.join(' ')} (granted: ${granted?.join(' ') || 'none'}). Check the OAuth client's Scopes in Admin Center.`;
    checks.push({ key: 'token', label: `Gets an OAuth token from ${host}`, ok: false, detail: message });
    return { reachable: true, authorized: false, checks, note: null, error: message };
  }
  checks.push({
    key: 'token',
    label: `Gets an OAuth token from ${host}`,
    ok: true,
    detail: granted ? `Granted: ${granted.join(' ')}.` : `Granted. Zendesk did not list the scopes; asked for ${INSPECT_SCOPES.join(' ')}.`,
  });

  const { check: actsAs, reachedZendesk } = await actsAsCheck(credentials, deps);
  checks.push(actsAs);
  return {
    reachable: reachedZendesk,
    authorized: actsAs.ok,
    checks,
    note: 'Read-only. Nothing was saved by this test.',
    error: actsAs.ok ? null : actsAs.detail,
  };
}

/**
 * Which Zendesk user the client's token acts as, and whether that user can
 * work tickets. Shows the role and user id, never a name or email. Also says
 * whether the call got an HTTP answer at all: one that timed out or never
 * connected did not reach Zendesk, even though the token request before it did.
 * @param credentials - The parsed client.
 * @param deps - Injected for tests.
 */
async function actsAsCheck(credentials: ZendeskCredentials, deps?: ZendeskDeps): Promise<{ check: ConnectorCheck; reachedZendesk: boolean }> {
  const label = 'Reads which Zendesk user the client acts as';
  let body: unknown;
  try {
    body = await zendeskRequest(credentials, { path: '/api/v2/users/me.json', scopes: INSPECT_SCOPES }, deps);
  } catch (err) {
    const status = err instanceof ZendeskError ? err.status : null;
    return { check: { key: 'acts-as', label, ok: false, detail: messageOf(err) }, reachedZendesk: status !== null };
  }
  const user = (body as { user?: { id?: unknown; role?: unknown } } | null)?.user;
  const role = typeof user?.role === 'string' ? user.role : 'unknown';
  const id = typeof user?.id === 'number' || typeof user?.id === 'string' ? String(user.id) : 'unknown';
  if (STAFF_ROLES.has(role)) {
    return { check: { key: 'acts-as', label, ok: true, detail: `User ${id}, role ${role}. Its calls are made as this user.` }, reachedZendesk: true };
  }
  return {
    check: {
      key: 'acts-as',
      label,
      ok: false,
      detail: `User ${id}, role ${role}. Working tickets needs an agent or admin, so make the OAuth client while signed in as an admin.`,
    },
    reachedZendesk: true,
  };
}

/**
 * The message of whatever was thrown.
 * @param err - The thrown value.
 */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const zendeskConnector: SourceConnector<typeof zendeskConfigSchema> = {
  slug: 'zendesk',
  name: 'Zendesk',
  description: 'A Zendesk account, reached live through an OAuth client. Test connection shows which Zendesk user the client acts as. Nothing is copied into Vocion.',
  icon: 'MessageSquare',
  category: 'other',
  brand: 'zendesk',
  authKind: 'apikey',
  syncless: true,
  configSchema: zendeskConfigSchema,
  inspectNote: 'Gets an OAuth token and reads which Zendesk user the client acts as. Read-only. Nothing is saved.',

  async inspect({ credentials }) {
    return inspectZendesk({ credentials });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by the Zendesk tools, never mirrored.
  },
};
