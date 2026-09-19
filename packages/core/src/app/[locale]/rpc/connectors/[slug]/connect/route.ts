/**
 * GET  /rpc/connectors/[slug]/connect — what the connect card's form needs.
 * POST /rpc/connectors/[slug]/connect — connect it, from wherever the person is.
 *
 * The chat-surface twin of `/rpc/sources/[id]/credentials`. Same vault, same
 * tables, same rows — the difference is only that this one is addressed by
 * CONNECTOR SLUG, because a person hitting a gap mid-conversation has a
 * connector in front of them and no `knowledge_source` row id. It creates the
 * row when the connector needs one, so connecting from a chat card and
 * connecting from Settings leave the workspace in the same state.
 *
 * Who may do it depends on the connector's identity tier, and the split is the
 * point:
 *
 *   - **personal** (Gmail, Calendar, Drive; Zoom and Slack by default) — any
 *     member, for themselves. The grant carries their user id, so it resolves
 *     for them and for nobody else.
 *   - **shared** (HubSpot, Jira, Strapi …) — admins only. A shared key is a
 *     company asset, and one tap by whoever happened to be in a chat is the
 *     wrong way to bind one. A member's card says "ask an admin" instead, so
 *     this refusal is a backstop rather than the first time anyone finds out.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { VaultDecryptionError } from '@/libs/crypto/credentialVault';
import { CredentialValidationError, platformForConnectorSlug } from '@/libs/platforms/registry';
import { getConnector } from '@/libs/sources/registry';
import { resolveIdentity } from '@/libs/sources/types';
import { capabilityLedger } from '@/services/agents/capabilityLedger';
import { invalidateAgentGraphs } from '@/services/agents/harness';
import { listPlatformCredentials, storePlatformKey } from '@/services/ApiTokenService';
import {
  actorFor,
  CredentialInUseError,
  linkSourceToStoredCredential,
  storeCredentialForSource,
} from '@/services/SourceCredentialService';
import { addSource, listSources } from '@/services/SourceSyncService';

/**
 * Roles allowed to bind a credential for the whole workspace.
 * @param role
 */
function isAdmin(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'org:admin';
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { orgId, userId, role } = await auth();
  if (!orgId || !userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { slug } = await ctx.params;
  const connector = getConnector(slug);
  if (!connector) {
    return Response.json({ error: `No connector named ${slug}` }, { status: 404 });
  }
  const identity = resolveIdentity(connector.identity);
  if (identity === 'shared' && !isAdmin(role)) {
    return Response.json({ error: 'An admin connects this for the workspace.' }, { status: 403 });
  }

  const platform = platformForConnectorSlug(slug);
  // Metadata only — name and masked hint, never a decrypted value. This route
  // deliberately does NOT return the credentials in use: `/rpc/sources/[id]`
  // does that for an admin editing a form, and a chat card has no such reason.
  const available = platform && isAdmin(role) ? await listPlatformCredentials(orgId, platform.id) : [];
  const ledger = await capabilityLedger(orgId, { actor: actorFor(userId), role: role === 'admin' ? 'org:admin' : role });

  return Response.json({
    connector: { slug, name: connector.name, icon: connector.icon, authKind: connector.authKind, identity },
    state: ledger.get(slug)?.state ?? { kind: 'unavailable' },
    platform: platform?.id ?? null,
    helpText: platform?.helpText ?? null,
    // RegExp does not survive the wire, so the form gets the human hint and
    // the server stays the only place a shape is enforced.
    fields: (platform?.fields ?? []).map(f => ({
      name: f.name,
      label: f.label,
      shapeHint: f.shapeHint,
      secret: f.secret,
      optional: f.optional === true,
    })),
    available,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { orgId, userId, role } = await auth();
  if (!orgId || !userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { slug } = await ctx.params;
  const connector = getConnector(slug);
  if (!connector) {
    return Response.json({ error: `No connector named ${slug}` }, { status: 404 });
  }
  const identity = resolveIdentity(connector.identity);
  if (identity === 'shared' && !isAdmin(role)) {
    return Response.json({ error: 'An admin connects this for the workspace.' }, { status: 403 });
  }

  let body: { credentials?: Record<string, unknown>; credentialName?: string; apiTokenId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(body.credentials ?? {})) {
    if (typeof value === 'string' && value.trim() !== '') {
      raw[key] = value.trim();
    }
  }
  const pickedCredentialId = typeof body.apiTokenId === 'string' ? body.apiTokenId.trim() : '';
  if (pickedCredentialId === '' && Object.keys(raw).length === 0) {
    return Response.json({ error: 'Supply at least one credential value' }, { status: 400 });
  }

  try {
    // The connector's own row, created if the workspace has none. A connect
    // card can be the first time a workspace ever names a connector, and the
    // live tools resolve through that row — connecting without it would store
    // a credential nothing reads.
    const sourceId = await ensureConnectorSource(orgId, slug);

    if (identity === 'personal') {
      // Per-member, always. A personal grant is never stored as a workspace
      // platform credential, because a platform credential IS workspace-wide:
      // writing one here would hand this person's mailbox to everybody, which
      // is the exact bug the identity tiers exist to close.
      const { credentialId } = await storeCredentialForSource({
        orgId,
        sourceSlug: slug,
        raw,
        displayName: `${connector.name} — ${userId}`,
        userId,
        projectId: orgId,
      });
      invalidateAgentGraphs(orgId);
      return Response.json({ ok: true, credentialId, scope: 'user' });
    }

    const platform = platformForConnectorSlug(slug);
    if (platform) {
      const apiTokenId = pickedCredentialId !== ''
        ? pickedCredentialId
        : (await storePlatformKey({
            orgId,
            name: body.credentialName?.trim() || `${platform.label} — ${slug}`,
            platform: platform.id,
            values: raw,
            createdBy: userId,
            // A supplied key's lifetime belongs to the platform that issued
            // it, so Vocion adds no expiry of its own.
            expiresAt: null,
          })).id;
      if (sourceId !== null) {
        await linkSourceToStoredCredential({ orgId, sourceId, connectorSlug: slug, apiTokenId });
      }
      invalidateAgentGraphs(orgId);
      return Response.json({ ok: true, apiTokenId, scope: 'workspace' });
    }

    // A shared OAuth connector with no stored-credential platform: the grant
    // lives on the install, workspace-wide (`user_id` null).
    const { credentialId } = await storeCredentialForSource({
      orgId,
      sourceSlug: slug,
      raw,
      displayName: `${connector.name} — workspace`,
      userId: null,
      projectId: orgId,
    });
    invalidateAgentGraphs(orgId);
    return Response.json({ ok: true, credentialId, scope: 'workspace' });
  } catch (err) {
    // Only messages written for a person and naming no secret may cross.
    // Anything else carries whatever the database or the vault produced.
    const isSafeToShow = err instanceof CredentialValidationError
      || err instanceof CredentialInUseError
      || err instanceof VaultDecryptionError;
    console.error('[rpc/connectors/connect] could not store credential', {
      connectorSlug: slug,
      message: err instanceof Error ? err.message : String(err),
      cause: err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined,
    });
    return Response.json(
      { error: isSafeToShow ? (err as Error).message : 'Could not save the credential.' },
      { status: 400 },
    );
  }
}

/**
 * The `knowledge_source` row for this connector, creating one when the
 * workspace has none.
 *
 * Returns null for a connector whose config schema needs values nobody has
 * supplied — a web crawl needs a URL, and inventing one would be worse than
 * storing the credential and letting the person add the source properly. The
 * credential is still stored either way.
 * @param orgId - The workspace.
 * @param slug - Connector slug.
 */
async function ensureConnectorSource(orgId: string, slug: string): Promise<number | null> {
  const existing = (await listSources(orgId)).find(
    s => s.slug === slug || (s.config as { _connector?: string } | null)?._connector === slug,
  );
  if (existing) {
    return existing.id;
  }
  try {
    const created = await addSource({ orgId, kind: slug, slug, configJson: {} });
    return created.id;
  } catch {
    // The connector's config schema wants values a connect card never asks
    // for. Not an error for the person: the credential is what they came to
    // supply, and the source can be added from Settings.
    return null;
  }
}
