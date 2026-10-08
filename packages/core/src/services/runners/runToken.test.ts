import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isInstallationRunnerToken, RUN_TOKEN_TTL_MS, signRunToken, signStartToken, START_TOKEN_TTL_MS, verifyRunToken } from './runToken';

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

describe('a run token and a start token', () => {
  it('a run token is for one run, bound to the runner holding its lease, and short-lived', () => {
    const before = Date.now();
    const claim = verifyRunToken(signRunToken({ orgId: 'org_northwind', runId: 41, target: 'on-box', workerId: 'on-box-host-7' }));

    expect(claim).toMatchObject({ use: 'run', orgId: 'org_northwind', runId: 41, target: 'on-box', workerId: 'on-box-host-7' });
    // Hours, not the six it used to be: every heartbeat renews it, so it need not outlast a run.
    expect(claim!.exp - before).toBeLessThanOrEqual(RUN_TOKEN_TTL_MS + 1000);
    expect(RUN_TOKEN_TTL_MS).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
  });

  it('a start token says it is one, and lasts only as long as a container takes to boot', () => {
    const before = Date.now();
    const claim = verifyRunToken(signStartToken({ orgId: 'org_kestrel', runId: 42, target: 'aws-fargate' }));

    expect(claim).toMatchObject({ use: 'start', orgId: 'org_kestrel', runId: 42, target: 'aws-fargate' });
    expect(claim!.workerId).toBeUndefined();
    expect(claim!.exp - before).toBeLessThanOrEqual(START_TOKEN_TTL_MS + 1000);
  });

  it('a token minted before uses existed still reads, as a run token with no lease binding', () => {
    // What the previous core minted: { orgId, runId, target, exp }, same key, same shape.
    const key = createHmac('sha256', 'test-only-signing-secret').update('vocion:runner:run-token:v1').digest();
    const body = Buffer.from(JSON.stringify({ orgId: 'org_northwind', runId: 7, target: 'on-box', exp: Date.now() + 60_000 }), 'utf8').toString('base64url');
    const legacy = `vrt_${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;

    expect(verifyRunToken(legacy)).toEqual({ orgId: 'org_northwind', runId: 7, target: 'on-box', exp: expect.any(Number), use: 'run' });
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
