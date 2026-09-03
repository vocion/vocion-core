/**
 * Credential platform registry — the pure rules that decide which platforms
 * exist, which of them Vocion mints, what a pasted key must look like, and how
 * much of a key the UI is allowed to show.
 *
 * These are the guards standing between "a person pasted something" and "we
 * stored it as a live credential", so every branch gets a case, including the
 * ones that refuse.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLATFORM_ID,
  getPlatform,
  holdsManyCredentials,
  isCredentialPlatformId,
  keyHint,
  listPlatforms,
  MANY_CREDENTIAL_PLATFORM_IDS,
  platformForConnectorSlug,
  platformForLLMProvider,
  validatePlatformCredential,
  validatePlatformKey,
  visibleFields,
} from './registry';

describe('platform table', () => {
  it('lists vocion first, as the default selection', () => {
    expect(listPlatforms()[0]?.id).toBe(DEFAULT_PLATFORM_ID);
  });

  it('mints only the vocion platform; every other key is supplied', () => {
    const minted = listPlatforms().filter(platform => platform.keySource === 'minted');

    expect(minted.map(platform => platform.id)).toEqual(['vocion']);
  });

  it('gives every platform a label, a shape hint and help text', () => {
    for (const platform of listPlatforms()) {
      expect(platform.label.length).toBeGreaterThan(0);
      expect(platform.keyShapeHint.length).toBeGreaterThan(0);
      expect(platform.helpText.length).toBeGreaterThan(0);
    }
  });

  it('maps at most one platform to any given LLM provider', () => {
    // Two platforms claiming the same provider would make "the org's OpenAI
    // key" ambiguous at resolution time.
    const providers = listPlatforms()
      .map(platform => platform.llmProvider)
      .filter(provider => provider !== null);

    expect(new Set(providers).size).toBe(providers.length);
  });
});

describe('isCredentialPlatformId', () => {
  it('accepts a known id', () => {
    expect(isCredentialPlatformId('anthropic')).toBe(true);
  });

  it('rejects an unknown id', () => {
    expect(isCredentialPlatformId('mystery-llm')).toBe(false);
  });

  it('rejects non-strings coming off the wire', () => {
    expect(isCredentialPlatformId(undefined)).toBe(false);
    expect(isCredentialPlatformId(7)).toBe(false);
    expect(isCredentialPlatformId({ id: 'openai' })).toBe(false);
  });
});

describe('getPlatform', () => {
  it('returns the descriptor for a known id', () => {
    expect(getPlatform('openai').label).toBe('OpenAI');
  });

  it('throws on an unknown id rather than returning undefined', () => {
    // @ts-expect-error — deliberately outside the union; this is the runtime guard.
    expect(() => getPlatform('mystery-llm')).toThrow(/unknown credential platform/);
  });
});

describe('platformForLLMProvider', () => {
  it('finds the platform whose key authenticates a provider', () => {
    expect(platformForLLMProvider('anthropic')?.id).toBe('anthropic');
    expect(platformForLLMProvider('openai')?.id).toBe('openai');
    expect(platformForLLMProvider('vertex')?.id).toBe('vertex');
  });
});

describe('validatePlatformKey', () => {
  it('accepts a well-formed OpenAI key and trims it', () => {
    const key = validatePlatformKey('openai', '  sk-abcdefghijklmnop1234  ');

    expect(key).toBe('sk-abcdefghijklmnop1234');
  });

  it('accepts an OpenAI project key, which shares the sk- shape', () => {
    expect(validatePlatformKey('openai', 'sk-proj-abcdefghijklmnop1234')).toBe('sk-proj-abcdefghijklmnop1234');
  });

  it('accepts a well-formed Anthropic key', () => {
    expect(validatePlatformKey('anthropic', 'sk-ant-abcdefghijklmnop1234')).toBe('sk-ant-abcdefghijklmnop1234');
  });

  it('rejects a key that does not match its platform shape', () => {
    expect(() => validatePlatformKey('openai', 'hello')).toThrow(/does not look like a valid OpenAI key/);
  });

  it('rejects an Anthropic key pasted into the OpenAI slot only when the shape differs', () => {
    // `sk-ant-…` also satisfies the looser OpenAI pattern, so the shape check
    // cannot catch this — the person picked the wrong platform, and the
    // provider will reject the key. Documented here so the looseness is a
    // known choice rather than an accident.
    expect(() => validatePlatformKey('openai', 'sk-ant-abcdefghijklmnop1234')).not.toThrow();
    // The reverse IS caught: an OpenAI key in the Anthropic slot.
    expect(() => validatePlatformKey('anthropic', 'sk-abcdefghijklmnop1234')).toThrow(/Anthropic key/);
  });

  it('rejects an empty or whitespace-only key', () => {
    expect(() => validatePlatformKey('openai', '')).toThrow(/Enter the OpenAI key/);
    expect(() => validatePlatformKey('custom', '   ')).toThrow(/Enter the Credential/);
  });

  it('accepts any non-empty string for the custom platform', () => {
    expect(validatePlatformKey('custom', 'whatever-my-vendor-issued')).toBe('whatever-my-vendor-issued');
  });

  it('accepts any non-empty credential for Vertex, whose format we do not model', () => {
    expect(validatePlatformKey('vertex', '{"type":"service_account"}')).toBe('{"type":"service_account"}');
  });

  it('enforces the Azure shape', () => {
    expect(validatePlatformKey('azure-openai', 'a'.repeat(32))).toBe('a'.repeat(32));
    expect(() => validatePlatformKey('azure-openai', 'a'.repeat(31))).toThrow(/Azure OpenAI key/);
  });

  it('refuses to accept a supplied key for a minted platform', () => {
    expect(() => validatePlatformKey('vocion', 'vcn_live_abc_def')).toThrow(/generated by Vocion/);
  });

  it('never echoes the key back in the error message', () => {
    const secret = 'sk-ant-super-secret-value-here';
    try {
      validatePlatformKey('azure-openai', secret);
      throw new Error('expected a rejection');
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

describe('AWS, the one platform whose credential is a pair', () => {
  it('declares an access key id and a secret access key, in that order', () => {
    expect(getPlatform('aws').fields.map(field => field.name)).toEqual(['accessKeyId', 'secretAccessKey']);
  });

  it('marks the access key id as non-secret and the secret key as secret', () => {
    const [id, secret] = getPlatform('aws').fields;

    expect(id?.secret).toBe(false);
    expect(secret?.secret).toBe(true);
  });

  it('is wired to bedrock, so a Bedrock model call spends the org\'s own AWS key', () => {
    expect(getPlatform('aws').llmProvider).toBe('bedrock');
    expect(platformForLLMProvider('bedrock')?.id).toBe('aws');
  });

  it('accepts a well-formed pair', () => {
    const values = validatePlatformCredential('aws', {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });

    expect(values.accessKeyId).toBe('AKIAIOSFODNN7EXAMPLE');
  });

  it('accepts a temporary ASIA key id', () => {
    expect(() => validatePlatformCredential('aws', {
      accessKeyId: 'ASIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    })).not.toThrow();
  });

  it('names the offending field when one is malformed', () => {
    expect(() => validatePlatformCredential('aws', {
      accessKeyId: 'not-an-aws-key-id',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    })).toThrow(/Access key ID/);
  });

  it('refuses a pair with the secret missing', () => {
    expect(() => validatePlatformCredential('aws', {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    })).toThrow(/Enter the Secret access key/);
  });

  it('refuses to be treated as a single-secret platform', () => {
    expect(() => validatePlatformKey('aws', 'AKIAIOSFODNN7EXAMPLE')).toThrow(/more than one value/);
  });

  it('never echoes a secret in a rejection', () => {
    const secret = 'short-but-secret';
    try {
      validatePlatformCredential('aws', { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: secret });
      throw new Error('expected a rejection');
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

describe('keyHint', () => {
  it('shows only the last four characters', () => {
    expect(keyHint('sk-abcdefghijkl6789')).toBe('…6789');
  });

  it('masks a key too short to hint at safely', () => {
    expect(keyHint('abcd')).toBe('…');
    expect(keyHint('a')).toBe('…');
  });
});

describe('connector platforms', () => {
  /** The four connectors that authenticate with a key a person pastes. */
  const CONNECTOR_SLUGS = ['granola', 'hubspot', 'jira', 'strapi'] as const;

  it('gives every API-key connector a platform of its own', () => {
    for (const slug of CONNECTOR_SLUGS) {
      expect(platformForConnectorSlug(slug)?.id).toBe(slug);
    }
  });

  it('does not claim a connector that authenticates some other way', () => {
    // OAuth grants stay in `source_credential`, and these need no auth at all.
    for (const slug of ['drive', 'slack', 'zoom', 'web', 's3', 'localFiles']) {
      expect(platformForConnectorSlug(slug)).toBeNull();
    }
  });

  it('lets a workspace hold as many connector credentials as it wants', () => {
    for (const slug of CONNECTOR_SLUGS) {
      expect(holdsManyCredentials(slug)).toBe(true);
    }
  });

  it('still caps every implicitly-resolved platform at one live credential', () => {
    // The invariant the carve-out must not loosen: "the org's OpenAI key" has
    // to stay a single deterministic row.
    for (const id of ['openai', 'anthropic', 'vertex', 'azure-openai', 'aws', 'custom'] as const) {
      expect(holdsManyCredentials(id)).toBe(false);
    }
  });

  it('holds many Vocion tokens, one per integration', () => {
    expect(holdsManyCredentials('vocion')).toBe(true);
  });

  it('keeps the instance URL with the Strapi token, and shows it in full', () => {
    // A Strapi token is worthless against any other instance, so the URL is
    // part of the credential rather than configuration sitting next to it.
    const strapi = getPlatform('strapi');

    expect(strapi.fields.map(field => field.name)).toEqual(['baseUrl', 'token']);
    expect(visibleFields(strapi).map(field => field.name)).toEqual(['baseUrl']);
  });

  it('rejects a Strapi credential whose instance URL is not a URL', () => {
    expect(() => validatePlatformCredential('strapi', { baseUrl: 'cms.example.com', token: 'tok' }))
      .toThrow(/Instance URL/);
  });

  it('accepts a Strapi credential with a URL and a token', () => {
    expect(validatePlatformCredential('strapi', {
      baseUrl: ' https://cms.example.com ',
      token: ' strapi-token ',
    })).toEqual({ baseUrl: 'https://cms.example.com', token: 'strapi-token' });
  });

  it('pairs the Jira token with the email it was issued to', () => {
    const jira = getPlatform('jira');

    expect(jira.fields.map(field => field.name)).toEqual(['email', 'apiToken']);
    expect(visibleFields(jira).map(field => field.name)).toEqual(['email']);
  });

  it('rejects a Jira credential whose email is not an email', () => {
    expect(() => validatePlatformCredential('jira', { email: 'not-an-email', apiToken: 'tok' }))
      .toThrow(/Atlassian account email/);
  });

  it('needs no URL for a Jira credential, because the token works site-wide', () => {
    expect(getPlatform('jira').fields.some(field => field.name === 'baseUrl')).toBe(false);
  });

  it('names each field what the connector reads out of ctx.credentials', () => {
    // The field name is the storage contract between the credential and the
    // connector: store a Granola key under `apiKey` and the connector, which
    // reads `credentials.token`, refuses to sync with a credential that is
    // sitting right there.
    expect(getPlatform('granola').fields.map(field => field.name)).toEqual(['token']);
    expect(getPlatform('hubspot').fields.map(field => field.name)).toEqual(['token']);
    expect(getPlatform('jira').fields.map(field => field.name)).toEqual(['email', 'apiToken']);
    expect(getPlatform('strapi').fields.map(field => field.name)).toEqual(['baseUrl', 'token']);
  });

  it('hints at the secret half of a two-field connector credential', () => {
    // The list view masks the token, not the email or the URL beside it.
    const stored = validatePlatformCredential('jira', { email: 'ops@example.com', apiToken: 'abcd1234wxyz' });

    expect(keyHint(stored.apiToken!)).toBe('…wxyz');
  });
});

describe('MANY_CREDENTIAL_PLATFORM_IDS', () => {
  it('names every platform an org may hold several live credentials for', () => {
    expect([...MANY_CREDENTIAL_PLATFORM_IDS].sort()).toEqual(
      ['granola', 'hubspot', 'jira', 'strapi', 'vocion'],
    );
  });

  it('matches the list the partial unique index carves out', () => {
    // A partial index cannot call into TypeScript, so migration 0070 spells the
    // same platform ids out in SQL. If the two ever drift, an org either loses
    // the one-live cap on an LLM key or cannot hold a second connector
    // credential — and neither shows up until someone tries it.
    const migration = readFileSync(
      path.join(process.cwd(), 'migrations', '0076_connector_credentials.sql'),
      'utf8',
    );
    const carveOut = /platform"?\s+NOT IN \(([^)]*)\)/i.exec(migration);
    const idsInSql = (carveOut?.[1] ?? '')
      .split(',')
      .map(entry => entry.trim().replace(/^'|'$/g, ''))
      .filter(entry => entry.length > 0);

    expect(idsInSql.sort()).toEqual([...MANY_CREDENTIAL_PLATFORM_IDS].sort());
  });
});
