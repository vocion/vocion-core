import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Env', () => ({ Env: { AUTH_SECRET: 'test-secret-0123456789abcdef' } }));

const { connectReturnPrompt, connectStartHref, safeReturnPath } = await import('./returnTo');
const { returnUrl } = await import('./routes');
const { signState, verifyState } = await import('./state');

describe('safeReturnPath — never an open redirect', () => {
  it.each([
    ['//evil.example'],
    ['https://evil.example/dashboard/chat'],
    ['/\\evil.example'],
    ['/dashboard/../..//evil.example'],
    ['/dashboard/../login'],
    ['/login'],
    ['javascript:alert(1)'],
    [`/dashboard/${'x'.repeat(600)}`],
    [42],
  ])('refuses %s', (raw) => {
    expect(safeReturnPath(raw)).toBeNull();
  });

  it('keeps an in-app dashboard path with its query', () => {
    expect(safeReturnPath('/dashboard/chat?conversation=7')).toBe('/dashboard/chat?conversation=7');
  });
});

describe('returnUrl — back where the person came from', () => {
  it('lands on returnTo with the outcome added and its own query kept', () => {
    expect(returnUrl('', { ok: true }, 'github', '/dashboard/chat?conversation=7')).toBe('/dashboard/chat?conversation=7&connect=ok&source=github');
  });

  it('falls back to Sources for an unsafe returnTo', () => {
    expect(returnUrl('', { ok: false, reason: 'access_denied' }, 'github', '//evil.example')).toBe('/dashboard/sources?connect=error&reason=access_denied&source=github');
  });
});

describe('state carries returnTo, signed', () => {
  it('round-trips returnTo, and old states without it still verify', () => {
    const withBack = verifyState(signState({ provider: 'github', orgId: 'org_n', sourceSlug: 'github', userId: 'u1', returnTo: '/dashboard/chat?conversation=7' }));

    expect(withBack.ok && withBack.payload.returnTo).toBe('/dashboard/chat?conversation=7');

    const without = verifyState(signState({ provider: 'github', orgId: 'org_n', sourceSlug: 'github', userId: 'u1' }));

    expect(without.ok && without.payload.returnTo).toBeUndefined();
  });

  it('refuses a validly signed state whose returnTo is off-site', () => {
    const evil = verifyState(signState({ provider: 'github', orgId: 'org_n', sourceSlug: 'github', userId: 'u1', returnTo: '//evil.example' }));

    expect(evil).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('connectStartHref and connectReturnPrompt', () => {
  it('passes returnTo to the start route only when there is one', () => {
    expect(connectStartHref('github', 'github', null)).toBe('/api/connect/github/start?source=github');
    expect(connectStartHref('github', 'github', '/dashboard/chat?conversation=7')).toBe('/api/connect/github/start?source=github&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D7');
  });

  it('pre-fills an honest next message: success, failure, or nothing', () => {
    expect(connectReturnPrompt({ connect: 'ok', source: 'github' })).toBe('I connected github. What\'s next?');
    expect(connectReturnPrompt({ connect: 'error', reason: 'access_denied', source: 'github' })).toBe('Connecting github didn\'t work (access_denied). What should I try?');
    expect(connectReturnPrompt({})).toBeNull();
  });
});
