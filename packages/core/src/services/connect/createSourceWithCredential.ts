/**
 * Add a connector and its credential in one save (#1080). The Connectors page
 * form has the credential inside it: a value the person pasted, or the stored
 * login or key they chose to keep. One database transaction writes the key (when
 * one was pasted), the source and the link between them, so a failure anywhere
 * leaves nothing behind and the form can show the reason.
 *
 * This reuses the pieces the other paths use rather than a store of its own:
 * `sealPlatformKey` and `insertSealedPlatformKey` (the pieces of `storePlatformKey`) for a pasted value (its one-live-per-platform rule included),
 * and `saveWithin` for the source row and its link.
 *
 * Nothing here talks to the vendor. The first sync is the schedule's job.
 */

import type { StoredCredential } from './createSourceOnLogin';
import type { DbTransaction } from '@/libs/DbTransaction';
import type { CredentialPlatformId } from '@/libs/platforms/registry';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { CredentialValidationError, holdsManyCredentials, platformForConnectorSlug } from '@/libs/platforms/registry';
import { apiTokenSchema, knowledgeSourceSchema } from '@/models/Schema';
import { insertSealedPlatformKey, sealPlatformKey } from '@/services/ApiTokenService';
import { ConnectorCredentialError, CredentialInUseError } from '@/services/SourceCredentialService';
import { adminCheck, configProblem, connectorLabel, newestLiveCredential, resolveTarget, saveWithin } from './createSourceOnLogin';

/** Where the new source's credential comes from: the workspace's stored login or key, or values typed into the form. */
export type CredentialChoice
  = | { keepStored: true }
    | { values: Record<string, string> };

export type CreateSourceWithCredentialInput = {
  orgId: string;
  /** The person saving. Only an admin may. */
  actorUserId: string | undefined;
  connector: string;
  config: Record<string, unknown>;
  credential: CredentialChoice;
};

export type CreateSourceWithCredentialOutcome
  = | { ok: true; sourceId: number; slug: string }
    | { ok: false; reason: string };

const NOT_SAVED = 'The connector could not be saved, so nothing was added. Try again.';

/**
 * The pasted values with blanks dropped and the rest trimmed, the way the
 * credential dialog reads them.
 * @param values - What the person typed, by field name.
 */
function typedValues(values: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (value.trim() !== '') {
      kept[name] = value.trim();
    }
  }
  return kept;
}

/**
 * The sentence to show for a failure. Only the errors written for a person
 * pass through; anything else came from the database or the vault and is
 * logged, not shown.
 * @param error - What the save threw.
 * @param connector - Connector slug, for the log line.
 */
function reasonFor(error: unknown, connector: string): string {
  if (error instanceof CredentialValidationError || error instanceof CredentialInUseError || error instanceof ConnectorCredentialError) {
    return error.message;
  }
  logger.warn('adding a connector with its credential failed', { connector, reason: error instanceof Error ? error.message : 'unknown' });
  return NOT_SAVED;
}

/**
 * Refuse a pasted key that would strand another source. A platform that keeps
 * one live key per workspace (GitHub, Sentry, Notion, PostHog, Apollo) revokes
 * the saved one when a new key is stored, and nothing moves the sources still
 * reading it, so they would fail their next sync as "revoked". Until a
 * workspace can hold several accounts of one platform, the paste is refused
 * while a source reads a saved key that still works. An expired one does not
 * count: its sources are already broken, and a fresh key is the way out.
 *
 * Runs inside the save's transaction, so the check and the write see the same rows.
 * @param tx - The save's transaction.
 * @param orgId - The workspace.
 * @param platform - The platform the pasted key is for.
 * @param platform.id - Its id, which decides whether it keeps one key or many.
 * @param platform.label - Its name, for the sentence.
 */
async function refuseIfSavedKeyIsInUse(tx: DbTransaction, orgId: string, platform: { id: CredentialPlatformId; label: string }): Promise<void> {
  if (holdsManyCredentials(platform.id)) {
    return;
  }
  const [holder] = await tx
    .select({ slug: knowledgeSourceSchema.slug })
    .from(knowledgeSourceSchema)
    .innerJoin(apiTokenSchema, eq(apiTokenSchema.id, knowledgeSourceSchema.apiTokenId))
    .where(and(
      eq(apiTokenSchema.orgId, orgId),
      eq(apiTokenSchema.platform, platform.id),
      isNull(apiTokenSchema.revokedAt),
      or(isNull(apiTokenSchema.expiresAt), gt(apiTokenSchema.expiresAt, new Date())),
    ))
    .limit(1);
  if (holder) {
    throw new CredentialInUseError(`${platform.label} holds one key per workspace, and the ${holder.slug} connector already uses the saved one. Keep the saved one for this connector. A second ${platform.label} account isn't supported yet.`);
  }
}

/**
 * Save a new source and settle its credential in one transaction. Always a new
 * source: "Add" on the Connectors page never merges into an existing one.
 * @param input - Who, which connector, its settings and the credential choice.
 */
export async function createSourceWithCredential(input: CreateSourceWithCredentialInput): Promise<CreateSourceWithCredentialOutcome> {
  const notAdmin = await adminCheck(input.orgId, input.actorUserId);
  if (notAdmin) {
    return { ok: false, reason: notAdmin };
  }
  const platform = platformForConnectorSlug(input.connector);
  if (!platform) {
    return { ok: false, reason: `${connectorLabel(input.connector)} doesn't take a stored credential` };
  }
  const badConfig = configProblem(input.connector, input.config);
  if (badConfig) {
    return { ok: false, reason: badConfig };
  }
  let stored: StoredCredential | null = null;
  if ('keepStored' in input.credential) {
    stored = await newestLiveCredential(input.orgId, platform.id);
    if (!stored) {
      return { ok: false, reason: `This workspace has no saved ${connectorLabel(input.connector)} login or key yet. Paste one.` };
    }
  }
  const target = await resolveTarget({ orgId: input.orgId, actorUserId: input.actorUserId, connector: input.connector, config: input.config, createNew: true });
  if (target.kind === 'refuse') {
    return { ok: false, reason: target.reason };
  }
  try {
    // Sealed before the transaction opens: sealing reads the org's key through the pool.
    const sealed = 'values' in input.credential
      ? await sealPlatformKey({ orgId: input.orgId, platform: platform.id, values: typedValues(input.credential.values) })
      : null;
    const saved = await db.transaction(async (tx) => {
      let credential = stored;
      if (sealed) {
        await refuseIfSavedKeyIsInUse(tx, input.orgId, platform);
        const key = await insertSealedPlatformKey(tx, {
          orgId: input.orgId,
          name: `${platform.label} — ${target.slug}`,
          platform: platform.id,
          sealed,
          createdBy: input.actorUserId,
          expiresAt: null,
        });
        credential = { id: key.id, obtainedVia: 'paste', account: null, createdAt: new Date(), keyHint: key.keyHint };
      }
      return saveWithin(tx, { orgId: input.orgId, actorUserId: input.actorUserId, connector: input.connector, config: input.config, createNew: true }, target, credential!);
    });
    return { ok: true, ...saved };
  } catch (error) {
    return { ok: false, reason: reasonFor(error, input.connector) };
  }
}
