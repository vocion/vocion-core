/**
 * A person's own connections: who may make one, where it is kept, and the one
 * way anything reads it back (docs/guides/personal-connections.md).
 *
 * **Where it lives.** A personal connection is a login row in `api_token`
 * under the person's personal workspace — `project.kind = 'personal'`, one
 * per person per Org, owned by them and reachable by nobody else, Org admins
 * included (`WorkspaceAccessService`). The vault seals it under that
 * workspace's own data key, so the grant is the person's, not the Org's,
 * without a second credential store.
 *
 * **Who reads it.** Only {@link personalCredential}, and only for a turn whose
 * workspace IS that person's personal workspace and whose person is its
 * owner. A shared workspace never reaches it: its agents have no personal
 * tools, and the lookup refuses any workspace that is not the caller's own.
 * Nothing here ever turns a personal grant into a source.
 *
 * **The Org's switch.** `tenant_account.personal_connections` (0202). Off
 * stops new connections at the start route and stops every stored one from
 * being used; the rows stay until their owner disconnects them or leaves.
 */

import type { ConnectProviderId } from '@/libs/connect/provider';
import type { PersonalConnection } from '@/libs/personal/connections';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { providerFor } from '@/libs/connect/registry';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { PERSONAL_CONNECTIONS, personalConnectionFor } from '@/libs/personal/connections';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { getConnector } from '@/libs/sources/registry';
import { apiTokenSchema, knowledgeSourceSchema, projectSchema, tenantAccountSchema } from '@/models/Schema';
import { resolveCredentialById } from '@/services/ApiTokenService';

/** The person's own workspace, proven theirs. */
export type OwnWorkspace = { projectId: string; accountId: string };

/**
 * The workspace, when it is `userId`'s own personal workspace; null for a
 * shared workspace, someone else's personal one, or one that does not exist.
 * @param orgId - The workspace (`project.id`).
 * @param userId - The person.
 */
export async function ownPersonalWorkspace(orgId: string, userId: string): Promise<OwnWorkspace | null> {
  const [row] = await db
    .select({ kind: projectSchema.kind, ownerUserId: projectSchema.ownerUserId, accountId: projectSchema.accountId })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!row || row.kind !== 'personal' || !row.ownerUserId || row.ownerUserId !== userId) {
    return null;
  }
  return { projectId: orgId, accountId: row.accountId };
}

/**
 * Whether the Org lets its members connect their own accounts.
 * @param accountId - The Org (`tenant_account.id`).
 */
export async function personalConnectionsAllowed(accountId: string): Promise<boolean> {
  const [row] = await db
    .select({ allowed: tenantAccountSchema.personalConnections })
    .from(tenantAccountSchema)
    .where(eq(tenantAccountSchema.id, accountId))
    .limit(1);
  return row?.allowed ?? false;
}

/**
 * Turn personal connections on or off for a whole Org. The caller checks the
 * person is the Org's admin.
 * @param accountId - The Org.
 * @param allowed - On or off.
 */
export async function setPersonalConnectionsAllowed(accountId: string, allowed: boolean): Promise<void> {
  await db.update(tenantAccountSchema).set({ personalConnections: allowed }).where(eq(tenantAccountSchema.id, accountId));
}

/** The sentence a person reads when their Org has turned personal connections off. */
export const PERSONAL_CONNECTIONS_OFF = 'Your Org has turned off personal connections, so your own accounts cannot be connected or read. An Org admin can turn them back on in Personal connectors.';

/** Whether a personal connect may start or finish, and if not, why. */
export type PersonalConnectGate
  = | { ok: true; accountId: string; connection: PersonalConnection }
    | { ok: false; status: number; reason: string; error: string };

/**
 * May this person connect this connector as their own, in this workspace?
 * Only in their own personal workspace, only for a connector the personal
 * list names and its provider can serve, and only while the Org allows it.
 * @param input - The workspace, the person and the connector.
 * @param input.orgId - The session's workspace.
 * @param input.userId - The person.
 * @param input.connectorSlug - The connector the login is for.
 */
export async function personalConnectGate(input: { orgId: string; userId: string; connectorSlug: string }): Promise<PersonalConnectGate> {
  const own = await ownPersonalWorkspace(input.orgId, input.userId);
  if (!own) {
    return { ok: false, status: 403, reason: 'wrong_person', error: 'Only the owner of a personal workspace can connect their accounts to it.' };
  }
  const connection = personalConnectionFor(input.connectorSlug);
  if (!connection) {
    return { ok: false, status: 400, reason: 'not_personal', error: `${input.connectorSlug} is not something you can connect for yourself.` };
  }
  if (!(await personalConnectionsAllowed(own.accountId))) {
    return { ok: false, status: 403, reason: 'personal_off', error: PERSONAL_CONNECTIONS_OFF };
  }
  return { ok: true, accountId: own.accountId, connection };
}

/** One row of Personal connectors. Names and dates only: never a token. */
export type PersonalConnectionRow = {
  connector: string;
  provider: ConnectProviderId;
  label: string;
  brand: string | null;
  unlocks: string;
  /** Whether this server has an app for the person to log in with. */
  available: boolean;
  /** The account it is connected as, when it is. */
  account: string | null;
  connectedAt: Date | null;
};

type LoginRow = { id: string; platform: string; account: string | null; createdAt: Date };

/**
 * The live login rows the person's workspace holds for a platform, newest
 * first.
 * @param orgId - The personal workspace.
 * @param platforms - Platform ids.
 */
async function liveLogins(orgId: string, platforms: string[]): Promise<LoginRow[]> {
  if (platforms.length === 0) {
    return [];
  }
  return db
    .select({ id: apiTokenSchema.id, platform: apiTokenSchema.platform, account: apiTokenSchema.account, createdAt: apiTokenSchema.createdAt })
    .from(apiTokenSchema)
    .where(and(
      eq(apiTokenSchema.orgId, orgId),
      inArray(apiTokenSchema.platform, platforms),
      eq(apiTokenSchema.obtainedVia, 'login'),
      isNull(apiTokenSchema.revokedAt),
    ))
    .orderBy(desc(apiTokenSchema.createdAt), desc(apiTokenSchema.id));
}

/**
 * The credential bag of the person's newest login that serves this
 * connection, or null. A Google login made for Drive alone does not serve
 * Gmail: the provider says so from the scopes it was granted.
 * @param orgId - The personal workspace.
 * @param connection - The connection.
 */
async function servingLogin(orgId: string, connection: PersonalConnection): Promise<{ row: LoginRow; values: Record<string, unknown> } | null> {
  const platform = platformForConnectorSlug(connection.connector);
  if (!platform) {
    return null;
  }
  const provider = providerFor(connection.provider);
  for (const row of await liveLogins(orgId, [platform.id])) {
    const resolved = await resolveCredentialById(orgId, row.id);
    if (resolved.status !== 'ok') {
      continue;
    }
    const values = resolved.values as Record<string, unknown>;
    if (provider?.missingAccessFor?.(values, connection.connector, 'personal')) {
      continue;
    }
    return { row, values };
  }
  return null;
}

/**
 * Every personal connection, with whether the person has made it.
 * @param own - The person's own workspace.
 */
export async function listPersonalConnections(own: OwnWorkspace): Promise<PersonalConnectionRow[]> {
  return Promise.all(PERSONAL_CONNECTIONS.map(async (connection) => {
    const provider = providerFor(connection.provider);
    let login: Awaited<ReturnType<typeof servingLogin>> = null;
    try {
      login = await servingLogin(own.projectId, connection);
    } catch (error) {
      // A login that cannot be opened reads as not connected; the person can connect again.
      logger.warn('A personal connection could not be read', { orgId: own.projectId, connector: connection.connector, errorName: error instanceof Error ? error.name : 'unknown' });
    }
    return {
      connector: connection.connector,
      provider: connection.provider,
      label: connection.label,
      brand: getConnector(connection.connector)?.brand ?? null,
      unlocks: connection.unlocks,
      available: provider?.personal?.configured() ?? false,
      account: login?.row.account ?? null,
      connectedAt: login?.row.createdAt ?? null,
    };
  }));
}

/** The person's own credential for a connection, or the sentence that says why there is none. */
export type PersonalCredential
  = | { ok: true; tokenId: string; orgId: string; values: Record<string, unknown> }
    | { ok: false; why: string };

/**
 * THE way a personal credential is read. Refuses unless the workspace is the
 * person's own personal workspace, the Org allows personal connections, and
 * the person connected this connection. Never falls back to anyone else's
 * login, a workspace's login or the server's key.
 * @param input - The turn's workspace and person, and the connector.
 * @param input.orgId - The workspace the turn runs in.
 * @param input.userId - The person in the turn.
 * @param input.connector - The connection's connector slug.
 */
export async function personalCredential(input: { orgId: string; userId: string; connector: string }): Promise<PersonalCredential> {
  const connection = personalConnectionFor(input.connector);
  if (!connection) {
    return { ok: false, why: `${input.connector} is not a personal connector. Shared systems your team's agents use are team connectors, connected by an admin in Team connectors.` };
  }
  const own = await ownPersonalWorkspace(input.orgId, input.userId);
  if (!own) {
    return { ok: false, why: `${connection.label} is a personal connector: only your personal assistant reads it, from your own Personal workspace.` };
  }
  if (!(await personalConnectionsAllowed(own.accountId))) {
    return { ok: false, why: PERSONAL_CONNECTIONS_OFF };
  }
  const login = await servingLogin(own.projectId, connection);
  if (!login) {
    return { ok: false, why: `${connection.label} is not connected. Connect it in [Personal connectors](/dashboard/connectors).` };
  }
  return { ok: true, tokenId: login.row.id, orgId: own.projectId, values: login.values };
}

/** Best-effort revocation at the vendor, so disconnecting also withdraws the grant there. */
type VendorRevoke = (values: Record<string, unknown>) => Promise<void>;

const VENDOR_REVOKE: Partial<Record<ConnectProviderId, VendorRevoke>> = {
  google: async (values) => {
    const token = typeof values.refreshToken === 'string' ? values.refreshToken : typeof values.accessToken === 'string' ? values.accessToken : null;
    if (token) {
      await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10_000) });
    }
  },
  slack: async (values) => {
    if (typeof values.token === 'string') {
      await fetch('https://slack.com/api/auth.revoke', { method: 'POST', headers: { authorization: `Bearer ${values.token}` }, signal: AbortSignal.timeout(10_000) });
    }
  },
};

/**
 * Delete login rows outright — not revoke: a disconnected grant is data the
 * person asked us to stop holding. Sources that pointed at one are unlinked
 * first (that FK restricts). Each grant is withdrawn at its vendor first, best
 * effort: a vendor that does not answer never keeps the row here.
 * @param orgId - The personal workspace.
 * @param rows - The rows, with their platform.
 */
async function forgetLogins(orgId: string, rows: Array<{ id: string; platform: string }>): Promise<number> {
  for (const row of rows) {
    const connection = PERSONAL_CONNECTIONS.find(c => platformForConnectorSlug(c.connector)?.id === row.platform);
    const revoke = connection ? VENDOR_REVOKE[connection.provider] : undefined;
    if (!revoke) {
      continue;
    }
    try {
      const resolved = await resolveCredentialById(orgId, row.id);
      if (resolved.status === 'ok') {
        await revoke(resolved.values as Record<string, unknown>);
      }
    } catch (error) {
      logger.warn('A personal grant could not be withdrawn at its vendor; it is deleted here regardless', { orgId, platform: row.platform, errorName: error instanceof Error ? error.name : 'unknown' });
    }
  }
  const ids = rows.map(r => r.id);
  if (ids.length === 0) {
    return 0;
  }
  return db.transaction(async (tx) => {
    await tx.update(knowledgeSourceSchema).set({ apiTokenId: null }).where(and(eq(knowledgeSourceSchema.orgId, orgId), inArray(knowledgeSourceSchema.apiTokenId, ids)));
    const deleted = await tx.delete(apiTokenSchema).where(and(eq(apiTokenSchema.orgId, orgId), inArray(apiTokenSchema.id, ids))).returning({ id: apiTokenSchema.id });
    return deleted.length;
  });
}

/**
 * Disconnect one personal connection: every login of its platform in the
 * person's workspace. One Google login serves Gmail, Calendar and Drive, so
 * disconnecting one of them disconnects all three; the row says so.
 * @param own - The person's own workspace.
 * @param connector - The connection's connector slug.
 * @returns How many grants were deleted.
 */
export async function disconnectPersonalConnection(own: OwnWorkspace, connector: string): Promise<number> {
  const platform = personalConnectionFor(connector) ? platformForConnectorSlug(connector) : null;
  if (!platform) {
    return 0;
  }
  const rows = await liveLogins(own.projectId, [platform.id]);
  return forgetLogins(own.projectId, rows);
}

/**
 * Forget every credential a person's personal workspace on one Org holds,
 * live or revoked, vendor grants and minted tokens alike: called when they
 * leave the Org. (A person deleted outright is
 * handled in the database, by the 0202 trigger.)
 * @param userId - The person.
 * @param accountId - The Org they left.
 */
export async function forgetPersonalConnections(userId: string, accountId: string): Promise<number> {
  const [project] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(and(eq(projectSchema.accountId, accountId), eq(projectSchema.ownerUserId, userId), eq(projectSchema.kind, 'personal')));
  if (!project) {
    return 0;
  }
  const rows = await db
    .select({ id: apiTokenSchema.id, platform: apiTokenSchema.platform })
    .from(apiTokenSchema)
    .where(eq(apiTokenSchema.orgId, project.id));
  return forgetLogins(project.id, rows);
}
