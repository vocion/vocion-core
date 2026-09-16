/**
 * Which analytics property a `verified · web-analytics` measure reads, and as
 * whom.
 *
 * The rule the whole credential layer runs on: the org's stored credential
 * first, the deployment's env vars second, and never a cached answer shared
 * between orgs. The third case is the one with teeth — a measure read for one
 * workspace that resolved another workspace's property would put a stranger's
 * traffic on an executive report and label it verified.
 *
 * The credential store is mocked; nothing here touches the database or the
 * vault.
 */
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolvePlatformCredential = vi.fn<(orgId: string, platform: string) => Promise<Record<string, string> | null>>();

vi.mock('@/services/ApiTokenService', () => ({
  resolvePlatformCredential: (orgId: string, platform: string) => resolvePlatformCredential(orgId, platform),
}));

const { normalizePrivateKey, resolveWebAnalyticsCredentials } = await import('./credentials');

const PEM = '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n';
const ORG_CREDENTIAL = { propertyId: '100000001', clientEmail: 'reader@example-org.iam.gserviceaccount.com', privateKey: PEM };

const ENV_KEYS = ['GOOGLE_ANALYTICS_PROPERTY_ID', 'GOOGLE_ANALYTICS_CLIENT_EMAIL', 'GOOGLE_ANALYTICS_PRIVATE_KEY'] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));

function setServerCredential() {
  process.env.GOOGLE_ANALYTICS_PROPERTY_ID = '200000002';
  process.env.GOOGLE_ANALYTICS_CLIENT_EMAIL = 'deployment@example-server.iam.gserviceaccount.com';
  process.env.GOOGLE_ANALYTICS_PRIVATE_KEY = PEM;
}

beforeEach(() => {
  resolvePlatformCredential.mockReset();
  resolvePlatformCredential.mockResolvedValue(null);
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('resolveWebAnalyticsCredentials', () => {
  it('asks for the credential of the workspace the measure is read for', async () => {
    await resolveWebAnalyticsCredentials('proj_measured');

    expect(resolvePlatformCredential).toHaveBeenCalledWith('proj_measured', 'google-analytics');
  });

  it('uses the workspace\'s stored credential in preference to the deployment\'s', async () => {
    setServerCredential();
    resolvePlatformCredential.mockResolvedValue(ORG_CREDENTIAL);

    const resolved = await resolveWebAnalyticsCredentials('proj_measured');

    expect(resolved).toMatchObject({ source: 'org', propertyId: ORG_CREDENTIAL.propertyId });
    expect(resolved?.serviceAccount.clientEmail).toBe(ORG_CREDENTIAL.clientEmail);
  });

  it('falls back to the deployment\'s env vars for a workspace that stored none', async () => {
    setServerCredential();

    const resolved = await resolveWebAnalyticsCredentials('proj_measured');

    expect(resolved).toMatchObject({ source: 'environment', propertyId: '200000002' });
  });

  it('never carries one workspace\'s property into the next workspace\'s read', async () => {
    // The repo rule for every outbound path: two orgs in sequence, each with
    // its own credential. A cache keyed on anything looser than the exact
    // credential would answer the second workspace with the first one's
    // traffic and still call the reading verified.
    resolvePlatformCredential.mockImplementation(async orgId => orgId === 'proj_first'
      ? { propertyId: '100000001', clientEmail: 'first@example-a.iam.gserviceaccount.com', privateKey: PEM }
      : { propertyId: '300000003', clientEmail: 'second@example-b.iam.gserviceaccount.com', privateKey: PEM });

    const first = await resolveWebAnalyticsCredentials('proj_first');
    const second = await resolveWebAnalyticsCredentials('proj_second');

    expect([first?.propertyId, second?.propertyId]).toEqual(['100000001', '300000003']);
    expect([first?.serviceAccount.clientEmail, second?.serviceAccount.clientEmail])
      .toEqual(['first@example-a.iam.gserviceaccount.com', 'second@example-b.iam.gserviceaccount.com']);
  });

  it('answers null when neither the workspace nor the deployment has configured analytics', async () => {
    // Null is what becomes the "not connected — showing nothing" state. It is
    // the ordinary answer for an unconfigured workspace, not an error.
    await expect(resolveWebAnalyticsCredentials('proj_measured')).resolves.toBeNull();
  });

  it('treats a half-filled credential as not configured rather than trying it', async () => {
    resolvePlatformCredential.mockResolvedValue({ propertyId: '100000001', clientEmail: ORG_CREDENTIAL.clientEmail });

    await expect(resolveWebAnalyticsCredentials('proj_measured')).resolves.toBeNull();
  });

  it('does not let a half-filled stored credential shadow a complete server one', async () => {
    setServerCredential();
    resolvePlatformCredential.mockResolvedValue({ propertyId: '100000001' });

    const resolved = await resolveWebAnalyticsCredentials('proj_measured');

    expect(resolved).toMatchObject({ source: 'environment' });
  });

  it('lets a vault failure surface rather than reading the deployment\'s property as this workspace', async () => {
    setServerCredential();
    resolvePlatformCredential.mockRejectedValue(new Error('vault'));

    await expect(resolveWebAnalyticsCredentials('proj_measured')).rejects.toThrow('vault');
  });
});

describe('normalizePrivateKey', () => {
  it('unescapes a key pasted with literal \\n, as env vars and JSON files carry it', () => {
    expect(normalizePrivateKey('-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----\\n')).toBe(PEM);
  });

  it('leaves a key that already has real newlines alone', () => {
    expect(normalizePrivateKey(PEM)).toBe(PEM);
  });
});
