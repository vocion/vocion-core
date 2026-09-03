/**
 * GET  /rpc/sources/[id]/credentials — what the connector's credential form
 *      needs to open.
 *
 *      Returns `{ credentials, available, linkedCredentialId, platform }`:
 *      the values currently in use (admin-only, and the ONLY place plaintext
 *      leaves the vault for the browser — an Edit form that cannot show the
 *      token it is about to keep reads as if it deleted it), plus, for an
 *      API-key connector, the credentials the workspace already holds for that
 *      platform so setup can offer them instead of asking for the key again.
 *
 * POST /rpc/sources/[id]/credentials — connect the connector to a credential.
 *
 *      Body is one of:
 *        `{ apiTokenId }` — point the install at a credential the workspace
 *          already holds. Nothing is pasted and nothing is duplicated.
 *        `{ apiTokenId, credentials: { ... } }` — replace the values of that
 *          credential, keeping its id. This is rotation: every install
 *          pointing at it picks the new value up with no edit of its own.
 *        `{ credentials: { ... }, credentialName? }` — supply the values. For
 *          an API-key connector these are stored as a new workspace
 *          credential, so they show up under API credentials and the next
 *          connector can reuse them; for every other connector they are
 *          stored against the install as before.
 *
 *      Connector-specific keys: most read a single `token`; Jira takes an
 *      `email` alongside its `apiToken`; Strapi takes the instance `baseUrl`
 *      with its token; googleAds adds a `developerToken`; zoom takes a full
 *      Server-to-Server OAuth set ({ accountId, clientId, clientSecret }) and
 *      no token at all. At least one non-empty value is required. The
 *      plaintext is AES-GCM encrypted at rest; only ciphertext + dek id hit
 *      the DB. Admin-only.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { CredentialValidationError, platformForConnectorSlug } from '@/libs/platforms/registry';
import { listPlatformCredentials, rotatePlatformCredential, storePlatformKey } from '@/services/ApiTokenService';
import {
  ConnectorCredentialError,
  connectorHoldingCredential,
  credentialIdsInUse,
  CredentialInUseError,
  credentialInUseMessage,
  getCredentialsForConnector,
  linkSourceToStoredCredential,
  storeCredentialForSource,
  storedCredentialIdForSource,
} from '@/services/SourceCredentialService';
import { getSourceById } from '@/services/SourceSyncService';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; locale: string }> },
) {
  const { orgId, role } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Same gate as writing one: an operator who can replace the token is the only
  // one who has any reason to read it.
  if (role !== 'admin') {
    return Response.json({ error: 'Only admins can read source credentials' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const sourceId = Number.parseInt(id, 10);
  if (!Number.isInteger(sourceId)) {
    return Response.json({ error: 'Bad source id' }, { status: 400 });
  }
  const source = await getSourceById(orgId, sourceId);
  if (!source) {
    return Response.json({ error: 'Source not found' }, { status: 404 });
  }
  const connectorSlug = (source.config?._connector as string | undefined) ?? source.slug;
  const platform = platformForConnectorSlug(connectorSlug);
  // Metadata only — name and masked hint, nothing decrypted. This is what lets
  // setup offer a key the workspace already typed instead of asking again.
  const storedForPlatform = platform ? await listPlatformCredentials(orgId, platform.id) : [];
  const linkedCredentialId = await storedCredentialIdForSource(orgId, sourceId);
  // One credential belongs to one connector, so a credential another connector
  // holds is left out rather than offered and then refused. This connector's
  // own is kept, since it is the current pick.
  const takenElsewhere = new Set(await credentialIdsInUse(orgId, sourceId));
  const available = storedForPlatform.filter(credential => !takenElsewhere.has(credential.id));
  // The form's fields come from the platform descriptor rather than a copy kept
  // in the page, so Strapi's instance URL and Jira's email arrive without the
  // browser needing to know either connector exists. RegExp does not survive
  // the wire, so the form gets the human hint and the server stays the only
  // place a shape is enforced.
  const fields = (platform?.fields ?? []).map(field => ({
    name: field.name,
    label: field.label,
    shapeHint: field.shapeHint,
    secret: field.secret,
  }));
  try {
    const credentials = await getCredentialsForConnector({ orgId, connectorSlug, apiTokenId: linkedCredentialId });
    return Response.json({
      credentials: credentials ?? null,
      available,
      linkedCredentialId,
      platform: platform?.id ?? null,
      platformLabel: platform?.label ?? null,
      helpText: platform?.helpText ?? null,
      fields,
    });
  } catch (err) {
    // Two different failures land here. A credential the install points at but
    // cannot use is reported with its own reason so the form can say which key
    // to fix; anything else is the vault-key case, whose message already says
    // what to do about it. Either way, reporting beats pretending there is no
    // credential, which would have the form silently offer to keep something
    // unusable.
    if (err instanceof ConnectorCredentialError) {
      return Response.json({
        credentials: null,
        available,
        linkedCredentialId,
        platform: platform?.id ?? null,
        platformLabel: platform?.label ?? null,
        helpText: platform?.helpText ?? null,
        fields,
        credentialBroken: err.reason,
        error: err.message,
      });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; locale: string }> },
) {
  const { orgId, userId, role } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (role !== 'admin') {
    return Response.json({ error: 'Only admins can set source credentials' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const sourceId = Number.parseInt(id, 10);
  if (!Number.isInteger(sourceId)) {
    return Response.json({ error: 'Bad source id' }, { status: 400 });
  }

  let body: {
    credentials?: Record<string, unknown>;
    displayName?: string;
    /** Point the install at a credential the workspace already holds. */
    apiTokenId?: string;
    /** Name for a credential stored from values pasted here. */
    credentialName?: string;
  };
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
    return Response.json(
      { error: 'Pick a stored credential, or supply at least one credential value' },
      { status: 400 },
    );
  }

  const source = await getSourceById(orgId, sourceId);
  if (!source) {
    return Response.json({ error: 'Source not found' }, { status: 404 });
  }
  const connectorSlug = (source.config?._connector as string | undefined) ?? source.slug;
  const platform = platformForConnectorSlug(connectorSlug);

  // A named credential plus values is rotation. The row id has to survive,
  // because every install pointing at it resolves through that id — replacing
  // the row instead would leave them all on the old key.
  if (pickedCredentialId !== '' && Object.keys(raw).length > 0) {
    // Asked before anything is written. Rotating first and linking afterwards
    // would replace the value of a credential another connector depends on,
    // and only then refuse to hand it over — leaving that connector on a key
    // nobody chose for it.
    const heldBy = await connectorHoldingCredential(orgId, pickedCredentialId, sourceId);
    if (heldBy !== null) {
      return Response.json({ error: credentialInUseMessage(heldBy) }, { status: 400 });
    }
    try {
      const rotated = await rotatePlatformCredential({
        orgId,
        tokenId: pickedCredentialId,
        values: raw,
      });
      if (rotated.status !== 'ok') {
        return Response.json(
          { error: rotated.status === 'revoked'
            ? 'That credential was revoked. Store a new one instead.'
            : 'That credential no longer exists.' },
          { status: 400 },
        );
      }
      // Rotation says nothing about which credential this connector uses, so
      // one still being connected for the first time gets linked too.
      await linkSourceToStoredCredential({
        orgId,
        sourceId,
        connectorSlug,
        apiTokenId: pickedCredentialId,
      });
      return Response.json({ ok: true, apiTokenId: pickedCredentialId, keyHint: rotated.keyHint });
    } catch (err) {
      const isSafeToShow = err instanceof CredentialValidationError || err instanceof CredentialInUseError;
      console.error('[rpc/sources/credentials] could not rotate stored credential', {
        connectorSlug,
        message: err instanceof Error ? err.message : String(err),
      });
      return Response.json(
        { error: isSafeToShow ? err.message : 'Could not save the credential.' },
        { status: 400 },
      );
    }
  }

  // Picking a stored credential: nothing is pasted, nothing is duplicated, and
  // this connector simply starts naming the row it should have named all along.
  if (pickedCredentialId !== '') {
    try {
      await linkSourceToStoredCredential({
        orgId,
        sourceId,
        connectorSlug,
        apiTokenId: pickedCredentialId,
      });
      return Response.json({ ok: true, apiTokenId: pickedCredentialId });
    } catch (err) {
      const isSafeToShow = err instanceof ConnectorCredentialError || err instanceof CredentialInUseError;
      console.error('[rpc/sources/credentials] could not link stored credential', {
        connectorSlug,
        message: err instanceof Error ? err.message : String(err),
      });
      return Response.json(
        { error: isSafeToShow ? err.message : 'Could not use that credential.' },
        { status: 400 },
      );
    }
  }

  // Values pasted for an API-key connector become a workspace credential, not
  // a copy hidden inside this install. That is what puts them in the
  // credentials list and lets the next connector reuse them.
  if (platform) {
    try {
      const stored = await storePlatformKey({
        orgId,
        name: body.credentialName?.trim() || `${platform.label} — ${source.slug}`,
        platform: platform.id,
        values: raw,
        createdBy: userId ?? undefined,
        // A supplied key's lifetime belongs to the platform that issued it, so
        // Vocion adds no expiry of its own. Revoking is how one ends.
        expiresAt: null,
      });
      await linkSourceToStoredCredential({
        orgId,
        sourceId,
        connectorSlug,
        apiTokenId: stored.id,
      });
      return Response.json({ ok: true, apiTokenId: stored.id, keyHint: stored.keyHint });
    } catch (err) {
      // Only the registry's own validation messages are safe to show: each is
      // written for the person filling the form and names no secret. Anything
      // else came from the database or the vault and can carry a constraint
      // detail or a KMS error, so it is logged and replaced.
      const isSafeToShow = err instanceof CredentialValidationError || err instanceof CredentialInUseError;
      console.error('[rpc/sources/credentials] could not store platform credential', {
        connectorSlug,
        platform: platform.id,
        message: err instanceof Error ? err.message : String(err),
      });
      return Response.json(
        { error: isSafeToShow ? err.message : 'Could not save the credential.' },
        { status: 400 },
      );
    }
  }

  try {
    const { credentialId } = await storeCredentialForSource({
      orgId,
      sourceSlug: connectorSlug,
      raw,
      displayName: body.displayName,
      userId,
      projectId: orgId,
    });
    return Response.json({ ok: true, credentialId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rpc/sources/credentials] could not store install credential', {
      connectorSlug,
      message,
    });
    return Response.json({ error: message }, { status: 500 });
  }
}
