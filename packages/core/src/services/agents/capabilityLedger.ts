/**
 * capabilityLedger — what this workspace, and this person, can actually reach.
 *
 * One question asked once per turn, answered for every connector at once:
 * is this connected, could it be, and by whom?* Three existing things are
 * read and nothing new is stored — the connector registry (`libs/sources`),
 * the workspace's stored API credentials (`api_token`), and the grants on its
 * installs (`source_credential`).
 *
 * It exists because the agent's tool surface and the Sources page were
 * answering the same question separately. The tools asked "is a source of this
 * kind in scope", the page asked "does a live credential exist", and the two
 * could disagree — an agent confidently reporting no HubSpot data while the
 * connectors page showed a green badge. Both now read this, so the dashboard
 * and the agent cannot drift.
 *
 * The states are what a CARD has to be able to say, which is why `broken` and
 * `needs-admin` are separate from `connectable`. "Connect HubSpot" is the
 * wrong sentence for a member who is not allowed to, and for a grant somebody
 * revoked last Tuesday.
 */

import type { ResolvedIdentity, SourceAuthKind, SourceConnector } from '@/libs/sources/types';
import type { Actor } from '@/services/SourceCredentialService';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { getConnector, listConnectors } from '@/libs/sources/registry';
import { resolveIdentity } from '@/libs/sources/types';
import { apiTokenSchema, sourceCredentialSchema, sourceInstallSchema } from '@/models/Schema';

/**
 * What stands between this actor and using a connector.
 *
 * `unavailable` and `ready` are the two ends. Everything between them is a
 * different sentence on the card, and collapsing any two of them would mean
 * telling somebody to do something they cannot do or do not need to.
 */
export type CapabilityState
  /** A live credential this actor can spend. Nothing to ask for. */
  = | { kind: 'ready' }
    /** Nobody has connected it and this actor may. */
    | { kind: 'connectable'; scope: 'user' | 'workspace'; authKind: SourceAuthKind }
    /** A workspace-tier source, and this actor is a member. Someone else connects it. */
    | { kind: 'needs-admin' }
    /** A credential exists and cannot be spent. Reconnect, not connect. */
    | { kind: 'broken'; reason: 'revoked' | 'expired' }
    /** This build ships no such connector. Not a gap — an absence. */
    | { kind: 'unavailable' };

/** One connector, as the ledger describes it. */
export type Capability = {
  slug: string;
  /** Human label — `Google Calendar`, not `google-calendar`. */
  name: string;
  /** Lucide icon name, so the card and the Sources page draw the same tile. */
  icon: string;
  /** Whose credential it runs on, with `either` already settled. */
  identity: ResolvedIdentity;
  authKind: SourceAuthKind;
  state: CapabilityState;
  /**
   * A workspace-wide grant exists AND this actor has none of their own.
   *
   * The `either` tier's second line: Slack defaults to a personal connection,
   * but if a colleague already connected the workspace's Slack there is no
   * reason to make this person authorise anything. Only ever an offer — the
   * card says so and the person chooses.
   */
  workspaceGrantAvailable: boolean;
};

/** Every connector, keyed by slug. */
export type CapabilityLedger = Map<string, Capability>;

/**
 * Who is asking, and what they are allowed to decide for the workspace.
 *
 * `role` is the session's own role, not anything the model can influence. A
 * member never reaches `connectable` on a workspace-tier source: a shared
 * HubSpot token is a company asset, and one tap by anyone who happens to be
 * in a chat is the wrong way to bind one.
 */
export type LedgerActor = {
  actor: Actor;
  role?: string | null;
};

/**
 * True for a role allowed to connect a workspace-tier source.
 * @param role
 */
function isAdmin(role: string | null | undefined): boolean {
  return role === 'org:admin';
}

/**
 * Read the whole capability picture for one org and one actor.
 *
 * Two queries regardless of how many connectors are registered: every live
 * `source_credential` row for the org's installs, and every live `api_token`.
 * The per-connector answer is then pure computation, so this is cheap enough
 * to run on every turn and on every render of the Sources page.
 * @param orgId - The workspace.
 * @param who - The person asking and what they may decide.
 */
export async function capabilityLedger(orgId: string, who: LedgerActor): Promise<CapabilityLedger> {
  const [grants, storedKeys] = await Promise.all([
    db
      .select({
        slug: sourceInstallSchema.sourceSlug,
        userId: sourceCredentialSchema.userId,
        createdAt: sourceCredentialSchema.createdAt,
      })
      .from(sourceCredentialSchema)
      .innerJoin(sourceInstallSchema, eq(sourceInstallSchema.id, sourceCredentialSchema.installId))
      .where(and(
        eq(sourceInstallSchema.orgId, orgId),
        eq(sourceInstallSchema.disabled, 'false'),
        isNull(sourceCredentialSchema.revokedAt),
      ))
      .orderBy(desc(sourceCredentialSchema.createdAt)),
    db
      .select({ platform: apiTokenSchema.platform, expiresAt: apiTokenSchema.expiresAt })
      .from(apiTokenSchema)
      .where(and(eq(apiTokenSchema.orgId, orgId), isNull(apiTokenSchema.revokedAt))),
  ]);

  const now = Date.now();
  const livePlatforms = new Set(
    storedKeys
      .filter(k => k.expiresAt === null || k.expiresAt.getTime() > now)
      .map(k => k.platform),
  );
  const expiredPlatforms = new Set(
    storedKeys
      .filter(k => k.expiresAt !== null && k.expiresAt.getTime() <= now)
      .map(k => k.platform),
  );

  const ownGrants = new Set<string>();
  const workspaceGrants = new Set<string>();
  for (const grant of grants) {
    if (grant.userId === null) {
      workspaceGrants.add(grant.slug);
    } else if (who.actor.kind === 'user' && grant.userId === who.actor.id) {
      ownGrants.add(grant.slug);
    }
  }

  const ledger: CapabilityLedger = new Map();
  for (const connector of listConnectors()) {
    ledger.set(connector.slug, describe(connector, who, {
      ownGrants,
      workspaceGrants,
      livePlatforms,
      expiredPlatforms,
    }));
  }
  return ledger;
}

/**
 * What one connector's state is, given everything already read.
 * @param connector
 * @param who
 * @param seen
 * @param seen.ownGrants
 * @param seen.workspaceGrants
 * @param seen.livePlatforms
 * @param seen.expiredPlatforms
 */
function describe(
  connector: SourceConnector,
  who: LedgerActor,
  seen: {
    ownGrants: Set<string>;
    workspaceGrants: Set<string>;
    livePlatforms: Set<string>;
    expiredPlatforms: Set<string>;
  },
): Capability {
  const identity = resolveIdentity(connector.identity);
  const hasWorkspaceGrant = seen.workspaceGrants.has(connector.slug);
  const base = {
    slug: connector.slug,
    name: connector.name,
    icon: connector.icon,
    identity,
    authKind: connector.authKind,
    workspaceGrantAvailable: hasWorkspaceGrant && !seen.ownGrants.has(connector.slug),
  };

  // Needs nothing. The `web` connector and the local file readers are always
  // reachable — there is no gap to offer.
  if (connector.authKind === 'none') {
    return { ...base, state: { kind: 'ready' } };
  }

  if (identity === 'personal') {
    // The actor's own grant first, then the workspace one — the same
    // precedence `getCredentialsForConnector` resolves by, so the card can
    // never say "connect this" about a credential the next turn would spend.
    if (seen.ownGrants.has(connector.slug) || hasWorkspaceGrant) {
      return { ...base, state: { kind: 'ready' } };
    }
    // A system actor has no id and therefore no personal grant to offer.
    // Nothing to connect in a run with no person in it.
    if (who.actor.kind === 'system') {
      return { ...base, state: { kind: 'unavailable' } };
    }
    return { ...base, state: { kind: 'connectable', scope: 'user', authKind: connector.authKind } };
  }

  // Shared. An API-key connector answers from the workspace's stored
  // credential for its platform; an OAuth one from the install's grant.
  const platform = platformForConnectorSlug(connector.slug);
  if (platform && seen.livePlatforms.has(platform.id)) {
    return { ...base, state: { kind: 'ready' } };
  }
  if (hasWorkspaceGrant || seen.ownGrants.has(connector.slug)) {
    return { ...base, state: { kind: 'ready' } };
  }
  if (platform && seen.expiredPlatforms.has(platform.id)) {
    return { ...base, state: { kind: 'broken', reason: 'expired' } };
  }
  // A shared credential is a company asset, so a member is told who connects
  // it rather than offered a button that binds one for everybody.
  if (!isAdmin(who.role)) {
    return { ...base, state: { kind: 'needs-admin' } };
  }
  return { ...base, state: { kind: 'connectable', scope: 'workspace', authKind: connector.authKind } };
}

/**
 * The state of one connector, for a caller holding a slug.
 *
 * A connector this build does not ship reads `unavailable` rather than
 * throwing: a workspace can name a connector we removed, and the honest answer
 * to "can you reach it" is no, not a 500.
 * @param ledger - What `capabilityLedger` returned.
 * @param slug - Connector slug.
 */
export function capabilityFor(ledger: CapabilityLedger, slug: string): Capability {
  const known = ledger.get(slug);
  if (known) {
    return known;
  }
  const connector = getConnector(slug);
  return {
    slug,
    name: connector?.name ?? slug,
    icon: connector?.icon ?? 'Plug',
    identity: resolveIdentity(connector?.identity),
    authKind: connector?.authKind ?? 'none',
    state: { kind: 'unavailable' },
    workspaceGrantAvailable: false,
  };
}
