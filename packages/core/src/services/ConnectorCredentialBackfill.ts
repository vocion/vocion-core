/**
 * One-time move of an API-key connector's own credential copy into the
 * workspace's stored credentials.
 *
 * Before this, a Jira or Strapi connector kept its key in
 * `source_credential` — a second copy of a value the workspace very likely
 * already held under API credentials, rotating on its own schedule. A connector
 * now points at one stored credential instead
 * (`knowledge_source.api_token_id`), and this is what moves the existing ones
 * across.
 *
 * It cannot be a SQL migration. The value is encrypted under the org's DEK, so
 * moving it means decrypting with the vault and encrypting again into the new
 * row — application work, not something a migration file can express.
 *
 * Two deliberate choices:
 *
 *   - **The old row is left alone.** Resolution prefers `api_token_id` the
 *     moment it is set, so the copy in `source_credential` stops being read.
 *     Leaving it means a run that turns out to be wrong can be undone by
 *     clearing one column, rather than by finding a key nobody has any more.
 *   - **A connector that cannot be moved is reported, not fixed.** A Strapi
 *     connector with no instance URL, or one whose credential holds nothing
 *     that fits the platform's fields, is left exactly as it was and syncs
 *     exactly as it did. Guessing a value here would write a credential nobody
 *     can account for.
 *
 * Every connector row gets its own credential, even two of the same kind in one
 * workspace — they were configured against different instances, so folding them
 * onto one key would point one of them at the wrong place.
 *
 * Idempotent: a connector that already points at a stored credential is
 * skipped, so re-running adds nothing.
 */

import type { CredentialPlatform, CredentialValues } from '@/libs/platforms/registry';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { buildCredentialVault } from '@/libs/crypto/credentialVault';
import { db } from '@/libs/DB';
import {
  CredentialValidationError,
  listPlatforms,
  validatePlatformCredential,
} from '@/libs/platforms/registry';
import { knowledgeSourceSchema, sourceCredentialSchema, sourceInstallSchema } from '@/models/Schema';
import { storePlatformKey } from '@/services/ApiTokenService';

/** One connector the backfill moved across. */
export type MovedConnector = {
  orgId: string;
  sourceSlug: string;
  sourceId: number;
  apiTokenId: string;
};

/** One connector the backfill left alone, and why. */
export type SkippedConnector = {
  orgId: string;
  sourceSlug: string;
  sourceId: number;
  reason: string;
};

/** What one run of the backfill did. */
export type BackfillReport = {
  moved: MovedConnector[];
  skipped: SkippedConnector[];
};

/**
 * Field-name aliases the connectors have accepted for a pasted secret.
 *
 * The connectors read `credentials.token` or `credentials.apiToken`
 * interchangeably, so credentials stored over the years use both. The platform
 * descriptor names exactly one, and this is how an old row still finds it.
 */
const SECRET_ALIASES = ['token', 'apiToken', 'apiKey', 'accessToken'];

/**
 * The value for one credential field, out of the decrypted old credential or
 * the install's config, or `undefined` when neither holds it.
 * @param fieldName - The field the platform descriptor asks for.
 * @param stored - The decrypted `source_credential` document.
 * @param config - The connector's config, where Strapi's instance URL used to sit.
 */
function valueForField(
  fieldName: string,
  stored: Record<string, unknown>,
  config: Record<string, unknown>,
): string | undefined {
  // The credential first, then the install config — where Strapi's instance
  // URL used to live. Each is checked for a usable string rather than merely
  // for being present, so an empty value in one still falls through to the
  // other.
  for (const source of [stored, config]) {
    const candidate = source[fieldName];
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
  }
  if (!SECRET_ALIASES.includes(fieldName)) {
    return undefined;
  }
  for (const alias of SECRET_ALIASES) {
    const candidate = stored[alias];
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
  }
  return undefined;
}

/**
 * Assemble the new credential's values from the old copy plus the install's
 * config. Throws a `CredentialValidationError` when something the platform
 * needs is not there or does not fit.
 * @param platform - The platform the credential is being written for.
 * @param stored - The decrypted `source_credential` document.
 * @param config - The connector's config.
 */
function credentialValuesFor(
  platform: CredentialPlatform,
  stored: Record<string, unknown>,
  config: Record<string, unknown>,
): CredentialValues {
  const collected: CredentialValues = {};
  for (const field of platform.fields) {
    const value = valueForField(field.name, stored, config);
    if (value !== undefined) {
      collected[field.name] = value;
    }
  }
  // The registry's own validation, so a backfilled credential is held to
  // exactly the rules a pasted one is.
  return validatePlatformCredential(platform.id, collected);
}

/**
 * Move every API-key connector that still keeps its own credential copy onto a
 * stored workspace credential.
 *
 * Safe to run more than once. Returns what moved and what did not.
 */
export async function backfillConnectorCredentials(): Promise<BackfillReport> {
  const platformBySlug = new Map<string, CredentialPlatform>();
  for (const platform of listPlatforms()) {
    for (const slug of platform.connectorSlugs) {
      platformBySlug.set(slug, platform);
    }
  }

  // The connector a row runs is named in `config_json._connector`, and older
  // rows predate that hint and are named by their slug instead — the same
  // fallback the sync pipeline and the connectors page use.
  const sources = await db
    .select({
      id: knowledgeSourceSchema.id,
      orgId: knowledgeSourceSchema.orgId,
      slug: knowledgeSourceSchema.slug,
      config: knowledgeSourceSchema.configJson,
    })
    .from(knowledgeSourceSchema)
    .where(isNull(knowledgeSourceSchema.apiTokenId));

  const report: BackfillReport = { moved: [], skipped: [] };
  const vault = buildCredentialVault();

  for (const source of sources) {
    const config = (source.config ?? {}) as Record<string, unknown>;
    const connectorSlug = typeof config._connector === 'string' ? config._connector : source.slug;
    const platform = platformBySlug.get(connectorSlug);
    if (!platform) {
      // An OAuth connector, or one needing no credential. A grant belongs to
      // the one installation it was issued to, so there is nothing to move.
      continue;
    }

    const [existing] = await db
      .select({
        ciphertext: sourceCredentialSchema.ciphertext,
        nonce: sourceCredentialSchema.nonce,
        authTag: sourceCredentialSchema.authTag,
        dekId: sourceCredentialSchema.dekId,
        displayName: sourceCredentialSchema.displayName,
      })
      .from(sourceCredentialSchema)
      .innerJoin(sourceInstallSchema, eq(sourceInstallSchema.id, sourceCredentialSchema.installId))
      .where(and(
        eq(sourceInstallSchema.orgId, source.orgId),
        eq(sourceInstallSchema.sourceSlug, connectorSlug),
        isNull(sourceCredentialSchema.revokedAt),
      ))
      .orderBy(desc(sourceCredentialSchema.createdAt))
      .limit(1);

    if (!existing) {
      report.skipped.push({
        orgId: source.orgId,
        sourceSlug: connectorSlug,
        sourceId: source.id,
        reason: 'no live credential to move',
      });
      continue;
    }

    let stored: Record<string, unknown>;
    try {
      const plaintext = await vault.decrypt(
        source.orgId,
        existing.ciphertext,
        existing.nonce,
        existing.authTag,
        existing.dekId,
      );
      stored = JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>;
    } catch (error) {
      // A credential that will not open is a vault-key problem, not something
      // to fix here. Reported and left alone; the connector keeps working off
      // its own copy if that copy is readable in the running app.
      console.error('[backfillConnectorCredentials] could not decrypt an existing credential', {
        sourceId: source.id,
        sourceSlug: connectorSlug,
        message: error instanceof Error ? error.message : String(error),
      });
      report.skipped.push({
        orgId: source.orgId,
        sourceSlug: connectorSlug,
        sourceId: source.id,
        reason: 'existing credential could not be decrypted',
      });
      continue;
    }

    let values: CredentialValues;
    try {
      values = credentialValuesFor(platform, stored, config);
    } catch (error) {
      const reason = error instanceof CredentialValidationError
        ? error.message
        : 'existing credential does not fit the platform\'s fields';
      console.error('[backfillConnectorCredentials] could not assemble a credential', {
        sourceId: source.id,
        sourceSlug: connectorSlug,
        // The message names a field and a shape, never a value.
        message: reason,
      });
      report.skipped.push({
        orgId: source.orgId,
        sourceSlug: connectorSlug,
        sourceId: source.id,
        reason,
      });
      continue;
    }

    const created = await storePlatformKey({
      orgId: source.orgId,
      name: existing.displayName?.trim() || `${platform.label} — ${source.slug}`,
      platform: platform.id,
      values,
      // A supplied key's lifetime belongs to the platform that issued it.
      expiresAt: null,
    });

    // The instance URL now lives in the credential, so the config copy goes —
    // otherwise two places would claim to say which Strapi a token is for.
    const remainingConfig = { ...config };
    for (const field of platform.fields) {
      if (!field.secret && field.name in remainingConfig) {
        delete remainingConfig[field.name];
      }
    }

    await db
      .update(knowledgeSourceSchema)
      .set({ apiTokenId: created.id, configJson: remainingConfig })
      .where(eq(knowledgeSourceSchema.id, source.id));

    report.moved.push({
      orgId: source.orgId,
      sourceSlug: connectorSlug,
      sourceId: source.id,
      apiTokenId: created.id,
    });
  }

  return report;
}
