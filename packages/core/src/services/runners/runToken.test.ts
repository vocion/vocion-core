import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isInstallationRunnerToken, signRunToken, verifyRunToken } from './runToken';

// The credential one run carries (backlog 052). The secrets here are test values.
const previous = process.env.AUTH_SECRET;

beforeAll(() => {
  process.env.AUTH_SECRET = 'test-only-signing-secret';
});

afterAll(() => {
  process.env.AUTH_SECRET = previous;
});

describe('a run token', () => {
  it('carries the workspace, the run and the target, and nothing else verifies as one', () => {
    const token = signRunToken({ orgId: 'org_northwind', runId: 41, target: 'on-box' });

    expect(token.startsWith('vrt_')).toBe(true);
    expect(verifyRunToken(token)).toMatchObject({ orgId: 'org_northwind', runId: 41, target: 'on-box' });

    // A changed character inside the signature, never at its end: the last base64url character
    // can carry only padding bits, so "…xx" sometimes decoded to the same signature and verified.
    const at = token.length - 10;

    expect(verifyRunToken(`${token.slice(0, at)}${token[at] === 'A' ? 'B' : 'A'}${token.slice(at + 1)}`)).toBeNull();
    expect(verifyRunToken(token.replace('vrt_', 'vrt_e30'))).toBeNull();
    expect(verifyRunToken('vcn_live_abc_def')).toBeNull();
  });

  it('expires', () => {
    expect(verifyRunToken(signRunToken({ orgId: 'org_northwind', runId: 41, target: 'on-box' }, -1))).toBeNull();
  });

  it('is signed with a key of its own, so a changed signing secret refuses every token', () => {
    const token = signRunToken({ orgId: 'org_northwind', runId: 41, target: 'on-box' });
    process.env.AUTH_SECRET = 'another-test-secret';

    expect(verifyRunToken(token)).toBeNull();

    process.env.AUTH_SECRET = 'test-only-signing-secret';
  });
});

describe('the installation runner token', () => {
  it('matches only the configured value, and nothing when none is configured', () => {
    expect(isInstallationRunnerToken('fleet-secret', { VOCION_RUNNER_TOKEN: 'fleet-secret' })).toBe(true);
    expect(isInstallationRunnerToken('fleet-secreT', { VOCION_RUNNER_TOKEN: 'fleet-secret' })).toBe(false);
    expect(isInstallationRunnerToken('', {})).toBe(false);
    expect(isInstallationRunnerToken('anything', {})).toBe(false);
  });
});
