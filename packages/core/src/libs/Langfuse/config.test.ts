/**
 * How Vocion decides whether Langfuse tracing is on.
 *
 * This matters because of the failure it replaces. The Langfuse client
 * used to be constructed at import time with fallback credentials
 * (`pk-lf-vocion-demo` against `http://localhost:3200`), so a
 * production deployment that never set the real values still got a
 * working-looking tracer aimed at a port nothing listened on. Traces
 * failed for the life of the deployment and nothing said so.
 *
 * The rules under test give three outcomes and no silent fourth: off by
 * request, on with real credentials, or a loud error when someone asked
 * for tracing and left it unconfigured. Production is the strict case;
 * outside production the local compose defaults fill in so a fresh
 * checkout traces without any environment setup.
 *
 * Every case sets its own environment and restores it afterwards. No
 * test here constructs a client or makes a network call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserProjectId,
  LOCAL_DEVELOPMENT_BASE_URL,
  LOCAL_DEVELOPMENT_PROJECT_ID,
  LOCAL_DEVELOPMENT_PUBLIC_KEY,
  LOCAL_DEVELOPMENT_SECRET_KEY,
  MINIMUM_RETENTION_DAYS,
  resolveLangfuseConfig,
} from './config';

/**
 * Every variable the resolver reads, so each test starts from clean.
 *
 * Set through `vi.stubEnv` rather than by assigning `process.env`:
 * `NODE_ENV` is typed read-only, and stubbing restores every value
 * afterwards without a hand-rolled save-and-put-back.
 */
const LANGFUSE_VARIABLES = [
  'LANGFUSE_ENABLED',
  'LANGFUSE_BASE_URL',
  'LANGFUSE_PROJECT_ID',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'NEXT_PUBLIC_LANGFUSE_BASE_URL',
  'NEXT_PUBLIC_LANGFUSE_PROJECT_ID',
  'LANGFUSE_RETENTION_DAYS',
  'NODE_ENV',
] as const;

/**
 * Set one environment variable for the duration of a test.
 * @param name - Variable to set.
 * @param value - Value to set it to.
 */
function setEnv(name: string, value: string): void {
  vi.stubEnv(name, value);
}

beforeEach(() => {
  for (const name of LANGFUSE_VARIABLES) {
    vi.stubEnv(name, undefined);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Put the resolver in the strict branch. Production is where a missing
 * key has to be an error rather than a quiet fallback.
 */
function runAsProduction(): void {
  setEnv('NODE_ENV', 'production');
}

/** Credentials that look real enough to pass the presence checks. */
function setRealCredentials(): void {
  setEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-real');
  setEnv('LANGFUSE_SECRET_KEY', 'sk-lf-real');
  setEnv('LANGFUSE_BASE_URL', 'https://cloud.langfuse.com');
}

describe('LANGFUSE_ENABLED=false — tracing turned off by request', () => {
  it('reports disabled without needing any credentials', () => {
    runAsProduction();
    setEnv('LANGFUSE_ENABLED', 'false');

    const config = resolveLangfuseConfig();

    expect(config.enabled).toBe(false);
    expect(config).toMatchObject({ reason: 'turned off by LANGFUSE_ENABLED' });
  });

  it('stays disabled even when credentials are present, because the flag is explicit', () => {
    setRealCredentials();
    setEnv('LANGFUSE_ENABLED', 'false');

    expect(resolveLangfuseConfig().enabled).toBe(false);
  });

  it.each(['false', 'FALSE', '0', 'no', 'No'])('accepts %s as off', (value) => {
    setEnv('LANGFUSE_ENABLED', value);

    expect(resolveLangfuseConfig().enabled).toBe(false);
  });
});

describe('LANGFUSE_ENABLED=true — tracing demanded, so gaps are errors', () => {
  it.each(['true', 'TRUE', '1', 'yes', 'Yes'])('accepts %s as on', (value) => {
    setEnv('LANGFUSE_ENABLED', value);
    setRealCredentials();

    expect(resolveLangfuseConfig().enabled).toBe(true);
  });

  it('throws naming both keys when neither is set in production', () => {
    runAsProduction();
    setEnv('LANGFUSE_ENABLED', 'true');

    expect(() => resolveLangfuseConfig()).toThrow(
      /LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are not set/,
    );
  });

  it('throws naming only the missing key, in the singular', () => {
    runAsProduction();
    setEnv('LANGFUSE_ENABLED', 'true');
    setEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-real');

    expect(() => resolveLangfuseConfig()).toThrow(
      /LANGFUSE_SECRET_KEY is not set/,
    );
  });

  it('throws when keys are set but the base URL is missing in production', () => {
    runAsProduction();
    setEnv('LANGFUSE_ENABLED', 'true');
    setEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-real');
    setEnv('LANGFUSE_SECRET_KEY', 'sk-lf-real');

    expect(() => resolveLangfuseConfig()).toThrow(/LANGFUSE_BASE_URL is not set/);
  });

  it('points the reader at the deployment document rather than at the code', () => {
    runAsProduction();
    setEnv('LANGFUSE_ENABLED', 'true');

    expect(() => resolveLangfuseConfig()).toThrow(
      /docs\/deployment\/observability\.md/,
    );
  });

  it('returns the configured values when everything is set', () => {
    runAsProduction();
    setEnv('LANGFUSE_ENABLED', 'true');
    setRealCredentials();
    setEnv('LANGFUSE_PROJECT_ID', 'veerio');

    const config = resolveLangfuseConfig();

    expect(config).toEqual({
      enabled: true,
      publicKey: 'pk-lf-real',
      secretKey: 'sk-lf-real',
      baseUrl: 'https://cloud.langfuse.com',
      projectId: 'veerio',
      browserBaseUrl: 'https://cloud.langfuse.com',
      retentionDays: null,
    });
  });

  it('falls back to the demo project ID when none is given', () => {
    runAsProduction();
    setEnv('LANGFUSE_ENABLED', 'true');
    setRealCredentials();

    const config = resolveLangfuseConfig();

    expect(config).toMatchObject({ projectId: LOCAL_DEVELOPMENT_PROJECT_ID });
  });
});

describe('LANGFUSE_ENABLED unset — credentials decide', () => {
  it('is off in production when no credentials are configured', () => {
    runAsProduction();

    const config = resolveLangfuseConfig();

    expect(config.enabled).toBe(false);
    expect(config).toMatchObject({ reason: 'no credentials configured' });
  });

  it('is on in production once both keys are present', () => {
    runAsProduction();
    setRealCredentials();

    expect(resolveLangfuseConfig().enabled).toBe(true);
  });

  it('is off in production when only one key is present, rather than half-configured', () => {
    runAsProduction();
    setEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-real');

    expect(resolveLangfuseConfig().enabled).toBe(false);
  });

  it('is on outside production using the local compose defaults', () => {
    setEnv('NODE_ENV', 'development');

    const config = resolveLangfuseConfig();

    expect(config).toEqual({
      enabled: true,
      publicKey: LOCAL_DEVELOPMENT_PUBLIC_KEY,
      secretKey: LOCAL_DEVELOPMENT_SECRET_KEY,
      baseUrl: LOCAL_DEVELOPMENT_BASE_URL,
      projectId: LOCAL_DEVELOPMENT_PROJECT_ID,
      browserBaseUrl: LOCAL_DEVELOPMENT_BASE_URL,
      retentionDays: null,
    });
  });

  it('lets a local checkout point at a real instance without setting the flag', () => {
    setEnv('NODE_ENV', 'development');
    setRealCredentials();

    expect(resolveLangfuseConfig()).toMatchObject({
      publicKey: 'pk-lf-real',
      baseUrl: 'https://cloud.langfuse.com',
    });
  });
});

describe('bad input', () => {
  it('rejects a LANGFUSE_ENABLED value that is neither on nor off', () => {
    setEnv('LANGFUSE_ENABLED', 'maybe');

    expect(() => resolveLangfuseConfig()).toThrow(/LANGFUSE_ENABLED must be one of/);
  });

  it('treats a blank key as absent, since deployment tooling writes empty strings for unset', () => {
    runAsProduction();
    setEnv('LANGFUSE_PUBLIC_KEY', '   ');
    setEnv('LANGFUSE_SECRET_KEY', 'sk-lf-real');

    expect(resolveLangfuseConfig().enabled).toBe(false);
  });

  it('trims surrounding whitespace off values it does accept', () => {
    runAsProduction();
    setEnv('LANGFUSE_PUBLIC_KEY', ' pk-lf-real ');
    setEnv('LANGFUSE_SECRET_KEY', ' sk-lf-real ');
    setEnv('LANGFUSE_BASE_URL', ' https://cloud.langfuse.com ');

    expect(resolveLangfuseConfig()).toMatchObject({
      publicKey: 'pk-lf-real',
      secretKey: 'sk-lf-real',
      baseUrl: 'https://cloud.langfuse.com',
    });
  });

  it('treats a blank LANGFUSE_ENABLED as unset rather than as an error', () => {
    runAsProduction();
    setEnv('LANGFUSE_ENABLED', '');

    expect(resolveLangfuseConfig().enabled).toBe(false);
  });
});

describe('browser-facing URL and project — the self-hosted split', () => {
  it('uses the public mirror when the app reaches Langfuse over a private hostname', () => {
    runAsProduction();
    setEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-real');
    setEnv('LANGFUSE_SECRET_KEY', 'sk-lf-real');
    // What the app posts to, inside the compose network.
    setEnv('LANGFUSE_BASE_URL', 'http://langfuse-web:3000');
    // What a person's browser can actually open.
    setEnv('NEXT_PUBLIC_LANGFUSE_BASE_URL', 'https://traces.veerio.com');

    const config = resolveLangfuseConfig();

    expect(config).toMatchObject({
      baseUrl: 'http://langfuse-web:3000',
      browserBaseUrl: 'https://traces.veerio.com',
    });
  });

  it('mirrors the SDK project ID for links when no override is set', () => {
    runAsProduction();
    setRealCredentials();
    setEnv('LANGFUSE_PROJECT_ID', 'veerio');

    const config = resolveLangfuseConfig();
    if (!config.enabled) {
      throw new Error('expected tracing to be enabled for this case');
    }

    expect(browserProjectId(config)).toBe('veerio');
  });

  it('honours a separate project ID for links when one is set', () => {
    runAsProduction();
    setRealCredentials();
    setEnv('LANGFUSE_PROJECT_ID', 'veerio');
    setEnv('NEXT_PUBLIC_LANGFUSE_PROJECT_ID', 'veerio-public');

    const config = resolveLangfuseConfig();
    if (!config.enabled) {
      throw new Error('expected tracing to be enabled for this case');
    }

    expect(browserProjectId(config)).toBe('veerio-public');
  });
});

describe('LANGFUSE_RETENTION_DAYS — how long traces are kept', () => {
  it('keeps everything when unset, which is what Langfuse itself does', () => {
    runAsProduction();
    setRealCredentials();

    expect(resolveLangfuseConfig()).toMatchObject({ retentionDays: null });
  });

  it('reads 0 as keep everything rather than delete everything', () => {
    runAsProduction();
    setRealCredentials();
    setEnv('LANGFUSE_RETENTION_DAYS', '0');

    expect(resolveLangfuseConfig()).toMatchObject({ retentionDays: null });
  });

  it('accepts a period at or above the floor', () => {
    runAsProduction();
    setRealCredentials();
    setEnv('LANGFUSE_RETENTION_DAYS', '90');

    expect(resolveLangfuseConfig()).toMatchObject({ retentionDays: 90 });
  });

  it('accepts exactly the floor', () => {
    runAsProduction();
    setRealCredentials();
    setEnv('LANGFUSE_RETENTION_DAYS', String(MINIMUM_RETENTION_DAYS));

    expect(resolveLangfuseConfig()).toMatchObject({ retentionDays: MINIMUM_RETENTION_DAYS });
  });

  it('rejects a period under the floor instead of silently raising it', () => {
    runAsProduction();
    setRealCredentials();
    setEnv('LANGFUSE_RETENTION_DAYS', '1');

    expect(() => resolveLangfuseConfig()).toThrow(
      new RegExp(`must be 0 or at least ${MINIMUM_RETENTION_DAYS}`),
    );
  });

  it('rejects a negative period', () => {
    runAsProduction();
    setRealCredentials();
    setEnv('LANGFUSE_RETENTION_DAYS', '-7');

    expect(() => resolveLangfuseConfig()).toThrow(/whole number of days/);
  });

  it('rejects a fractional period, because half a day of traces is not a policy', () => {
    runAsProduction();
    setRealCredentials();
    setEnv('LANGFUSE_RETENTION_DAYS', '7.5');

    expect(() => resolveLangfuseConfig()).toThrow(/whole number of days/);
  });

  it('rejects something that is not a number at all', () => {
    runAsProduction();
    setRealCredentials();
    setEnv('LANGFUSE_RETENTION_DAYS', '90 days');

    expect(() => resolveLangfuseConfig()).toThrow(/whole number of days/);
  });

  it('is not read at all when tracing is off', () => {
    setEnv('LANGFUSE_ENABLED', 'false');
    setEnv('LANGFUSE_RETENTION_DAYS', 'nonsense');

    expect(resolveLangfuseConfig().enabled).toBe(false);
  });
});
