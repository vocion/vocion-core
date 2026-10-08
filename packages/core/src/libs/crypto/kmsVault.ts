/**
 * kmsVault — production CredentialVault backed by AWS KMS.
 *
 * Two-tier envelope encryption:
 *   1. KMS holds the customer master key (CMK) — never leaves AWS.
 *   2. We generate a 32-byte data encryption key (DEK) per tenant.
 *   3. Vocion encrypts each credential blob with the DEK + AES-256-GCM.
 *   4. KMS wraps the DEK for storage in `source_dek.wrapped_dek`.
 *   5. To decrypt, we ask KMS to unwrap the DEK (cached for ≤ 15 min),
 *      then run AES-GCM locally.
 *
 * Why envelope: KMS API limits + cost. One KMS call unwraps one DEK
 * for ~15 minutes of in-memory use; we never round-trip per credential.
 *
 * Each DEK is bound to its org. KMS wraps it under the EncryptionContext
 * `{ orgId }` and unwraps it only when handed the same context, so a wrapped
 * DEK copied onto another org's `source_dek` row will not open there, and every
 * unwrap is recorded in CloudTrail under the org it was for. On top of that,
 * a read names the org it is reading for and is refused when the DEK row
 * belongs to a different one — before any KMS call, and on a cache hit too.
 *
 * DEKs wrapped before the context was passed still open while
 * `VOCION_KMS_ALLOW_UNBOUND_DEKS` allows it (the default): an unwrap that KMS
 * refuses as `InvalidCiphertextException` is retried without a context, and a
 * DEK that opens that way is re-wrapped under its org's context in place
 * (`ReEncrypt`, so the plaintext key never travels again). A failed re-wrap is
 * logged and costs nothing else — the read still returns, and the next unwrap
 * tries again. IAM for the vault role: `kms:GenerateDataKey`, `kms:Decrypt`,
 * and `kms:ReEncryptFrom` + `kms:ReEncryptTo` for the re-wrap.
 *
 * That fallback is a hole while it is open: an unbound blob from an old row or
 * a backup, written onto another org's row by someone with database access,
 * opens there and is then re-wrapped as that org's. So it has an end. A fresh
 * deployment has no unbound DEKs and sets `VOCION_KMS_ALLOW_UNBOUND_DEKS=0`
 * from the start. An existing one runs `npm run vault:rewrap-deks`
 * (`bindKmsDeks`), which re-wraps every DEK under the key and says whether any
 * still needs the fallback, then turns it off.
 */

import type { CredentialVault, EncryptResult } from './credentialVault';
import type { DekRow } from './dekOwner';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { DecryptCommand, GenerateDataKeyCommand, KMSClient, ReEncryptCommand } from '@aws-sdk/client-kms';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { sourceDekSchema } from '@/models/Schema';
import {
  AES_KEY_BYTES,
  aesDecrypt,
  aesEncrypt,
  VaultDecryptionError,
} from './credentialVault';
import { crossOrgRefusal, dekRowFor } from './dekOwner';

const DEK_CACHE_MS = 15 * 60 * 1000;
/** The unwrapped key, and the org its row belongs to — a cache hit is checked against it. */
const dekCache = new Map<number, { key: Buffer; orgId: string; cachedAt: number }>();

export type KmsVaultOptions = {
  kmsKeyArn: string;
  region?: string;
  /**
   * Whether a DEK wrapped before the org context still opens (and is then
   * re-wrapped). Unset: `VOCION_KMS_ALLOW_UNBOUND_DEKS`, which is on unless it
   * says `0` or `false`.
   */
  allowUnboundDeks?: boolean;
};

/**
 * `VOCION_KMS_ALLOW_UNBOUND_DEKS`: on unless it says `0` or `false`, so an
 * existing deployment keeps reading its older DEKs until it chooses not to.
 */
function unboundDeksAllowedByEnvironment(): boolean {
  const raw = process.env.VOCION_KMS_ALLOW_UNBOUND_DEKS?.trim().toLowerCase();
  return raw !== '0' && raw !== 'false';
}

/**
 * The KMS EncryptionContext a DEK is wrapped under: the org it seals for.
 *
 * Not secret — KMS logs it in CloudTrail in the clear — and that is the point:
 * every unwrap says which org it was for.
 * @param orgId - The org the DEK belongs to.
 */
export function dekEncryptionContext(orgId: string): Record<string, string> {
  return { orgId };
}

/**
 * Whether KMS refused a ciphertext because it does not match what was asked —
 * for a DEK, an EncryptionContext different from the one it was wrapped under.
 * By name rather than `instanceof`: the SDK's error classes are per-package and
 * a bundler can load two copies.
 * @param error - Whatever `kms.send` threw.
 */
function isInvalidCiphertext(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'InvalidCiphertextException';
}

/**
 * The DEK wrapped again under its org's context, without the plaintext key
 * leaving KMS.
 * @param kms - The client.
 * @param keyArn - The key it is wrapped under, before and after.
 * @param dek - The row, as it was read.
 * @param sourceContext - The context it is wrapped under now; none for a DEK that predates them.
 */
async function reEncryptUnderOrg(kms: KMSClient, keyArn: string, dek: DekRow, sourceContext?: Record<string, string>): Promise<string> {
  const r = await kms.send(new ReEncryptCommand({
    CiphertextBlob: Buffer.from(dek.wrappedDek, 'base64'),
    SourceKeyId: keyArn,
    ...(sourceContext ? { SourceEncryptionContext: sourceContext } : {}),
    DestinationKeyId: keyArn,
    DestinationEncryptionContext: dekEncryptionContext(dek.orgId),
  }));
  if (!r.CiphertextBlob) {
    throw new Error('KMS ReEncrypt returned an empty CiphertextBlob');
  }
  return Buffer.from(r.CiphertextBlob).toString('base64');
}

/**
 * Store a re-wrapped DEK, conditional on the old value: a second process that
 * re-wrapped first wrote an equally valid blob, and there is nothing to gain by
 * overwriting it.
 * @param dek - The row, as it was read.
 * @param wrappedDek - The blob bound to its org.
 */
async function storeRewrapped(dek: DekRow, wrappedDek: string): Promise<void> {
  await db
    .update(sourceDekSchema)
    .set({ wrappedDek })
    .where(and(eq(sourceDekSchema.id, dek.id), eq(sourceDekSchema.wrappedDek, dek.wrappedDek)));
}

export function kmsVault(opts: KmsVaultOptions): CredentialVault {
  const kms = new KMSClient({ region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1' });
  const KEY_ARN = opts.kmsKeyArn;
  const allowUnboundDeks = opts.allowUnboundDeks ?? unboundDeksAllowedByEnvironment();

  async function getOrCreateActiveDek(orgId: string): Promise<DekRow> {
    const [existing] = await db
      .select({ id: sourceDekSchema.id, orgId: sourceDekSchema.orgId, wrappedDek: sourceDekSchema.wrappedDek })
      .from(sourceDekSchema)
      .where(and(eq(sourceDekSchema.orgId, orgId), eq(sourceDekSchema.kmsKeyArn, KEY_ARN)))
      .orderBy(desc(sourceDekSchema.createdAt))
      .limit(1);
    if (existing) {
      return existing;
    }
    return insertDek(orgId, null);
  }

  /**
   * Mint a DEK under the org's context and store its wrapped form. The cache is
   * seeded with the plaintext we already hold, so the first read costs no
   * round trip.
   * @param orgId - The org the DEK seals for.
   * @param rotatedAt - Set when this DEK replaces an earlier one.
   */
  async function insertDek(orgId: string, rotatedAt: Date | null): Promise<DekRow> {
    // GenerateDataKey gives us both the plaintext + KMS-wrapped form.
    const r = await kms.send(new GenerateDataKeyCommand({
      KeyId: KEY_ARN,
      KeySpec: 'AES_256',
      EncryptionContext: dekEncryptionContext(orgId),
    }));
    if (!r.Plaintext || !r.CiphertextBlob) {
      throw new Error('KMS GenerateDataKey returned empty Plaintext or CiphertextBlob');
    }
    const wrapped = Buffer.from(r.CiphertextBlob).toString('base64');
    const [created] = await db
      .insert(sourceDekSchema)
      .values({
        orgId,
        kmsKeyArn: KEY_ARN,
        wrappedDek: wrapped,
        algorithm: 'AES_256_GCM',
        ...(rotatedAt ? { rotatedAt } : {}),
      })
      .returning({ id: sourceDekSchema.id, orgId: sourceDekSchema.orgId, wrappedDek: sourceDekSchema.wrappedDek });
    dekCache.set(created!.id, { key: Buffer.from(r.Plaintext), orgId, cachedAt: Date.now() });
    return created!;
  }

  /**
   * Re-wrap a DEK that predates the EncryptionContext under its org's context,
   * in place. Best effort: the caller already holds the plaintext key, so a
   * failure here is logged and the next unwrap simply tries again.
   * @param dek - The row, as it was read.
   */
  async function rewrapUnderContext(dek: DekRow): Promise<void> {
    try {
      await storeRewrapped(dek, await reEncryptUnderOrg(kms, KEY_ARN, dek));
    } catch (error) {
      console.warn('[kmsVault] could not re-wrap a DEK under its org context; it still opens without one, and the next unwrap retries', {
        dekId: dek.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function unwrapDek(dek: DekRow): Promise<Buffer> {
    const ciphertextBlob = Buffer.from(dek.wrappedDek, 'base64');
    let plaintext: Uint8Array | undefined;
    let bound = true;
    try {
      plaintext = (await kms.send(new DecryptCommand({
        CiphertextBlob: ciphertextBlob,
        KeyId: KEY_ARN,
        EncryptionContext: dekEncryptionContext(dek.orgId),
      }))).Plaintext;
    } catch (error) {
      if (!isInvalidCiphertext(error)) {
        throw error;
      }
      if (!allowUnboundDeks) {
        // The deployment has closed the fallback, so a DEK that predates the
        // context is refused like one bound to another org: from here the two
        // look the same, and telling them apart would mean opening it.
        throw new VaultDecryptionError(
          'KMS would not unwrap the key that sealed this credential for this workspace: it was '
          + 'wrapped for a different workspace, is damaged, or predates per-workspace keys, which '
          + 'this deployment no longer opens. Reconnect the credential in this workspace.',
          { cause: error },
        );
      }
      // Wrapped before DEKs carried their org as context. Anything else KMS
      // refuses this way — a DEK bound to another org, a damaged blob — fails
      // this second attempt too.
      try {
        plaintext = (await kms.send(new DecryptCommand({ CiphertextBlob: ciphertextBlob, KeyId: KEY_ARN }))).Plaintext;
      } catch (legacyError) {
        if (!isInvalidCiphertext(legacyError)) {
          throw legacyError;
        }
        throw new VaultDecryptionError(
          'KMS would not unwrap the key that sealed this credential for this workspace: it was '
          + 'wrapped for a different workspace or is damaged. Reconnect the credential in this '
          + 'workspace.',
          { cause: error },
        );
      }
      bound = false;
    }
    if (!plaintext) {
      throw new Error('KMS Decrypt returned empty Plaintext');
    }
    const key = Buffer.from(plaintext);
    if (key.length !== AES_KEY_BYTES) {
      throw new Error(`KMS-unwrapped DEK is ${key.length} bytes; expected ${AES_KEY_BYTES}`);
    }
    dekCache.set(dek.id, { key, orgId: dek.orgId, cachedAt: Date.now() });
    if (!bound) {
      await rewrapUnderContext(dek);
    }
    return key;
  }

  /**
   * The plaintext DEK for a read made on behalf of `orgId`, refused when the
   * row belongs to another org — checked on the cached key as well, so a warm
   * cache is no way around it.
   * @param orgId - The org the read is for.
   * @param dekId - The DEK row the credential names.
   */
  async function dekFor(orgId: string, dekId: number): Promise<Buffer> {
    const cached = dekCache.get(dekId);
    if (cached && Date.now() - cached.cachedAt < DEK_CACHE_MS) {
      if (cached.orgId !== orgId) {
        throw crossOrgRefusal(dekId, cached.orgId, orgId);
      }
      return cached.key;
    }
    return unwrapDek(await dekRowFor(orgId, dekId));
  }

  return {
    kind: 'kms',
    async encrypt(orgId: string, plaintext: Buffer): Promise<EncryptResult> {
      const dek = await getOrCreateActiveDek(orgId);
      const key = await dekFor(orgId, dek.id);
      const { ciphertext, nonce, authTag } = aesEncrypt(key, plaintext);
      return {
        ciphertext: ciphertext.toString('base64'),
        nonce: nonce.toString('base64'),
        authTag: authTag.toString('base64'),
        dekId: dek.id,
      };
    },
    async decrypt(orgId, ciphertext, nonce, authTag, dekId) {
      const key = await dekFor(orgId, dekId);
      return aesDecrypt(
        key,
        Buffer.from(ciphertext, 'base64'),
        Buffer.from(nonce, 'base64'),
        Buffer.from(authTag, 'base64'),
      );
    },
    async rotateDek(orgId: string): Promise<number> {
      const created = await insertDek(orgId, new Date());
      return created.id;
    },
  };
}

/** What `bindKmsDeks` found, DEK by DEK. */
export type DekBindingReport = {
  /** DEK rows under the key. */
  total: number;
  /** Already wrapped under their org's context. */
  bound: number;
  /** Wrapped without a context, and re-wrapped under their org's (or would be, on a dry run). */
  rewrapped: number;
  /** Open under neither their own org's context nor none: another org's blob, or damaged. They do not open with the fallback either. */
  unopenable: number[];
  /** KMS refused for another reason (access, throttling); whether these are bound is unknown. */
  failed: Array<{ dekId: number; message: string }>;
  /** Whether turning `VOCION_KMS_ALLOW_UNBOUND_DEKS` off now would stop any DEK opening. */
  fallbackStillNeeded: boolean;
};

/**
 * Bind every DEK wrapped under the key to its org, so a deployment can close
 * the unbound fallback with evidence instead of waiting for each DEK to be read.
 *
 * Each row is first re-encrypted from its own org's context: if KMS accepts
 * that, it is already bound and nothing is written. If KMS refuses it as the
 * wrong context, it is re-encrypted from no context and stored, conditional on
 * the old value as the lazy re-wrap does. Neither step brings a plaintext key
 * into this process. Needs `kms:ReEncryptFrom` + `kms:ReEncryptTo`.
 * @param opts - The key, its region, and `dryRun` to report without writing.
 */
export async function bindKmsDeks(opts: KmsVaultOptions & { dryRun?: boolean }): Promise<DekBindingReport> {
  const kms = new KMSClient({ region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1' });
  const rows = await db
    .select({ id: sourceDekSchema.id, orgId: sourceDekSchema.orgId, wrappedDek: sourceDekSchema.wrappedDek })
    .from(sourceDekSchema)
    .where(eq(sourceDekSchema.kmsKeyArn, opts.kmsKeyArn))
    .orderBy(asc(sourceDekSchema.id));
  const report: DekBindingReport = { total: rows.length, bound: 0, rewrapped: 0, unopenable: [], failed: [], fallbackStillNeeded: false };
  const failed = (dek: DekRow, error: unknown) =>
    report.failed.push({ dekId: dek.id, message: error instanceof Error ? error.message : String(error) });

  for (const dek of rows) {
    try {
      await reEncryptUnderOrg(kms, opts.kmsKeyArn, dek, dekEncryptionContext(dek.orgId));
      report.bound += 1;
      continue;
    } catch (error) {
      if (!isInvalidCiphertext(error)) {
        failed(dek, error);
        continue;
      }
    }
    try {
      const rewrapped = await reEncryptUnderOrg(kms, opts.kmsKeyArn, dek);
      if (!opts.dryRun) {
        await storeRewrapped(dek, rewrapped);
      }
      report.rewrapped += 1;
    } catch (error) {
      if (isInvalidCiphertext(error)) {
        report.unopenable.push(dek.id);
      } else {
        failed(dek, error);
      }
    }
  }
  report.fallbackStillNeeded = report.failed.length > 0 || (Boolean(opts.dryRun) && report.rewrapped > 0);
  return report;
}

/** Used by tests to drop the in-memory cache. */
export function resetKmsCache(): void {
  dekCache.clear();
}
