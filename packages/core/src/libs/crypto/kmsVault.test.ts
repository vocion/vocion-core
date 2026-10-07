/**
 * The KMS vault binds each DEK to its org, against PGlite and a stand-in KMS.
 *
 * The stand-in keeps what real KMS keeps: a ciphertext blob opens only under
 * the EncryptionContext it was wrapped with, and the wrong context is an
 * `InvalidCiphertextException`. That is the behaviour the vault relies on for
 * two things — a DEK copied onto another org's row will not open, and a DEK
 * wrapped before contexts were passed still does, once, and is re-wrapped.
 *
 * The refusals matter most. A read for the wrong org fails with no KMS call at
 * all, and a warm cache is no way around it.
 */
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A KMS that remembers every blob it issued and the context it was bound to.
 * Every call is recorded by command name so a test can say what was asked.
 */
const kms = vi.hoisted(() => {
  const blobs = new Map<string, { plaintext: Uint8Array; context: Record<string, string> | undefined }>();
  const calls: Array<{ command: string; input: Record<string, unknown> }> = [];
  let failNext: { command: string; error: Error } | null = null;
  const sameContext = (a?: Record<string, string>, b?: Record<string, string>) =>
    JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());
  const invalid = () => Object.assign(new Error('The ciphertext refers to a customer master key that does not exist, does not exist in this region, or you are not allowed to access.'), { name: 'InvalidCiphertextException' });
  let counter = 0;
  const issue = (plaintext: Uint8Array, context?: Record<string, string>) => {
    counter += 1;
    const blob = new TextEncoder().encode(`blob-${counter}-${Math.random()}`);
    blobs.set(new TextDecoder().decode(blob), { plaintext, context });
    return blob;
  };
  const open = (blob: Uint8Array, context?: Record<string, string>) => {
    const entry = blobs.get(new TextDecoder().decode(blob));
    if (!entry || !sameContext(entry.context, context)) {
      throw invalid();
    }
    return entry.plaintext;
  };
  async function send(command: { name: string; input: Record<string, any> }) {
    calls.push({ command: command.name, input: command.input });
    if (failNext && failNext.command === command.name) {
      const { error } = failNext;
      failNext = null;
      throw error;
    }
    switch (command.name) {
      case 'GenerateDataKey': {
        const plaintext = new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
        return { Plaintext: plaintext, CiphertextBlob: issue(plaintext, command.input.EncryptionContext) };
      }
      case 'Decrypt':
        return { Plaintext: open(command.input.CiphertextBlob, command.input.EncryptionContext) };
      case 'ReEncrypt': {
        const plaintext = open(command.input.CiphertextBlob, command.input.SourceEncryptionContext);
        return { CiphertextBlob: issue(plaintext, command.input.DestinationEncryptionContext) };
      }
      default:
        throw new Error(`unexpected KMS command ${command.name}`);
    }
  }
  return {
    blobs,
    calls,
    issue,
    send,
    failNextCall(command: string, error: Error) {
      failNext = { command, error };
    },
    reset() {
      calls.length = 0;
      failNext = null;
    },
  };
});

vi.mock('@aws-sdk/client-kms', () => {
  const command = (name: string) => class {
    readonly name = name;
    constructor(readonly input: Record<string, unknown>) {}
  };
  return {
    KMSClient: class {
      send(cmd: { name: string; input: Record<string, unknown> }) {
        return kms.send(cmd);
      }
    },
    GenerateDataKeyCommand: command('GenerateDataKey'),
    DecryptCommand: command('Decrypt'),
    ReEncryptCommand: command('ReEncrypt'),
  };
});
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { sourceDekSchema } = await import('@/models/Schema');
const { kmsVault, resetKmsCache } = await import('./kmsVault');
const { VaultDecryptionError } = await import('./credentialVault');

const KEY_ARN = 'arn:aws:kms:us-west-2:000000000000:key/00000000-0000-0000-0000-000000000000';
const NORTHWIND = 'proj-kms-northwind';
const KESTREL = 'proj-kms-kestrel';

const commands = (name: string) => kms.calls.filter(c => c.command === name);

/**
 * A DEK row as the vault wrote them before the context landed: wrapped with
 * no EncryptionContext at all.
 * @param orgId - The org the row belongs to.
 */
async function insertLegacyDek(orgId: string): Promise<{ id: number; plaintext: Buffer; wrappedDek: string }> {
  const plaintext = randomBytes(32);
  const wrappedDek = Buffer.from(kms.issue(plaintext, undefined)).toString('base64');
  const [row] = await db
    .insert(sourceDekSchema)
    .values({ orgId, kmsKeyArn: KEY_ARN, wrappedDek, algorithm: 'AES_256_GCM' })
    .returning({ id: sourceDekSchema.id });
  return { id: row!.id, plaintext, wrappedDek };
}

/**
 * Seal a value with a known DEK the way the vault does, so a legacy row has a
 * credential to read back.
 * @param key - The plaintext DEK.
 * @param value - What to seal.
 */
async function sealWith(key: Buffer, value: string) {
  const { aesEncrypt } = await import('./credentialVault');
  const { ciphertext, nonce, authTag } = aesEncrypt(key, Buffer.from(value, 'utf8'));
  return { ciphertext: ciphertext.toString('base64'), nonce: nonce.toString('base64'), authTag: authTag.toString('base64') };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await db.delete(sourceDekSchema);
  resetKmsCache();
  kms.reset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('kmsVault binds every DEK to its org', () => {
  it('wraps a new DEK under { orgId } and unwraps it under the same context', async () => {
    const vault = kmsVault({ kmsKeyArn: KEY_ARN, region: 'us-west-2' });
    const sealed = await vault.encrypt(NORTHWIND, Buffer.from('nw-secret', 'utf8'));

    expect(commands('GenerateDataKey')[0]!.input.EncryptionContext).toEqual({ orgId: NORTHWIND });

    resetKmsCache();
    const opened = await vault.decrypt(NORTHWIND, sealed.ciphertext, sealed.nonce, sealed.authTag, sealed.dekId);

    expect(opened.toString('utf8')).toBe('nw-secret');
    expect(commands('Decrypt')).toHaveLength(1);
    expect(commands('Decrypt')[0]!.input.EncryptionContext).toEqual({ orgId: NORTHWIND });
    expect(commands('ReEncrypt')).toHaveLength(0);
  });

  it('gives each org its own DEK, and a rotation keeps the context', async () => {
    const vault = kmsVault({ kmsKeyArn: KEY_ARN });
    const nw = await vault.encrypt(NORTHWIND, Buffer.from('a'));
    const ks = await vault.encrypt(KESTREL, Buffer.from('b'));

    expect(nw.dekId).not.toBe(ks.dekId);

    // `source_dek_org_active_idx` is unique on (org, created_at); PGlite's
    // clock can hand two back-to-back inserts the same millisecond.
    await new Promise(resolve => setTimeout(resolve, 5));
    const rotated = await vault.rotateDek!(KESTREL);

    expect(commands('GenerateDataKey').map(c => c.input.EncryptionContext)).toEqual([
      { orgId: NORTHWIND },
      { orgId: KESTREL },
      { orgId: KESTREL },
    ]);

    const [row] = await db.select().from(sourceDekSchema).where(eq(sourceDekSchema.id, rotated));

    expect(row?.orgId).toBe(KESTREL);
    expect(row?.rotatedAt).toBeInstanceOf(Date);
  });
});

describe('kmsVault refuses a read made for another org', () => {
  it('refuses before calling KMS when the DEK row belongs to someone else', async () => {
    const vault = kmsVault({ kmsKeyArn: KEY_ARN });
    const sealed = await vault.encrypt(NORTHWIND, Buffer.from('nw-secret'));
    resetKmsCache();
    kms.reset();

    const read = vault.decrypt(KESTREL, sealed.ciphertext, sealed.nonce, sealed.authTag, sealed.dekId);

    await expect(read).rejects.toBeInstanceOf(VaultDecryptionError);
    await expect(read).rejects.toThrow(/sealed for a different workspace/);
    expect(kms.calls).toHaveLength(0);
  });

  it('refuses on a warm cache too', async () => {
    const vault = kmsVault({ kmsKeyArn: KEY_ARN });
    const sealed = await vault.encrypt(NORTHWIND, Buffer.from('nw-secret'));

    // The plaintext DEK is cached from the encrypt; the cache must still say no.
    await expect(vault.decrypt(KESTREL, sealed.ciphertext, sealed.nonce, sealed.authTag, sealed.dekId))
      .rejects
      .toBeInstanceOf(VaultDecryptionError);
    // And still answers the org it belongs to.
    await expect(vault.decrypt(NORTHWIND, sealed.ciphertext, sealed.nonce, sealed.authTag, sealed.dekId))
      .resolves
      .toEqual(Buffer.from('nw-secret'));
  });

  it('will not open a DEK wrapped for one org after it is copied onto another org\'s row', async () => {
    const vault = kmsVault({ kmsKeyArn: KEY_ARN });
    const nw = await vault.encrypt(NORTHWIND, Buffer.from('nw-secret'));
    const [nwRow] = await db.select().from(sourceDekSchema).where(eq(sourceDekSchema.id, nw.dekId));
    const [planted] = await db
      .insert(sourceDekSchema)
      .values({ orgId: KESTREL, kmsKeyArn: KEY_ARN, wrappedDek: nwRow!.wrappedDek, algorithm: 'AES_256_GCM' })
      .returning({ id: sourceDekSchema.id });
    resetKmsCache();

    const read = vault.decrypt(KESTREL, nw.ciphertext, nw.nonce, nw.authTag, planted!.id);

    await expect(read).rejects.toBeInstanceOf(VaultDecryptionError);
    await expect(read).rejects.toThrow(/wrapped for a different workspace/);
  });
});

describe('kmsVault reads a DEK wrapped before the context, and re-wraps it', () => {
  it('opens it without a context, then re-wraps it so the next unwrap needs only one call', async () => {
    const vault = kmsVault({ kmsKeyArn: KEY_ARN });
    const legacy = await insertLegacyDek(NORTHWIND);
    const sealed = await sealWith(legacy.plaintext, 'legacy-secret');

    const opened = await vault.decrypt(NORTHWIND, sealed.ciphertext, sealed.nonce, sealed.authTag, legacy.id);

    expect(opened.toString('utf8')).toBe('legacy-secret');
    expect(commands('Decrypt').map(c => c.input.EncryptionContext)).toEqual([{ orgId: NORTHWIND }, undefined]);
    expect(commands('ReEncrypt')).toHaveLength(1);
    expect(commands('ReEncrypt')[0]!.input.DestinationEncryptionContext).toEqual({ orgId: NORTHWIND });

    const [row] = await db.select().from(sourceDekSchema).where(eq(sourceDekSchema.id, legacy.id));

    expect(row?.wrappedDek).not.toBe(legacy.wrappedDek);

    resetKmsCache();
    kms.reset();

    await expect(vault.decrypt(NORTHWIND, sealed.ciphertext, sealed.nonce, sealed.authTag, legacy.id))
      .resolves
      .toEqual(Buffer.from('legacy-secret'));
    expect(commands('Decrypt')).toHaveLength(1);
    expect(commands('Decrypt')[0]!.input.EncryptionContext).toEqual({ orgId: NORTHWIND });
  });

  it('still answers when the re-wrap is refused, and says so in the log', async () => {
    const vault = kmsVault({ kmsKeyArn: KEY_ARN });
    const legacy = await insertLegacyDek(NORTHWIND);
    const sealed = await sealWith(legacy.plaintext, 'legacy-secret');
    kms.failNextCall('ReEncrypt', Object.assign(new Error('not authorized to perform kms:ReEncryptTo'), { name: 'AccessDeniedException' }));

    await expect(vault.decrypt(NORTHWIND, sealed.ciphertext, sealed.nonce, sealed.authTag, legacy.id))
      .resolves
      .toEqual(Buffer.from('legacy-secret'));

    const [row] = await db.select().from(sourceDekSchema).where(eq(sourceDekSchema.id, legacy.id));

    expect(row?.wrappedDek).toBe(legacy.wrappedDek);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not re-wrap'), expect.objectContaining({ dekId: legacy.id }));
  });

  it('does not fall back on a refusal that is not about the ciphertext', async () => {
    const vault = kmsVault({ kmsKeyArn: KEY_ARN });
    const legacy = await insertLegacyDek(NORTHWIND);
    const sealed = await sealWith(legacy.plaintext, 'legacy-secret');
    kms.failNextCall('Decrypt', Object.assign(new Error('not authorized to perform kms:Decrypt'), { name: 'AccessDeniedException' }));

    await expect(vault.decrypt(NORTHWIND, sealed.ciphertext, sealed.nonce, sealed.authTag, legacy.id))
      .rejects
      .toThrow(/kms:Decrypt/);
    expect(commands('Decrypt')).toHaveLength(1);
    expect(commands('ReEncrypt')).toHaveLength(0);
  });
});
