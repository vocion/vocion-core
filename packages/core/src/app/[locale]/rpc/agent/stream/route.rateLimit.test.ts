/**
 * The chat turn's limits: thirty turns a minute per person and 120 per
 * address, each refusal a 429 with `Retry-After` that is answered before the
 * body is read or a model is called. The earlier turns in the window are
 * counted through the same policy the route uses, so the test does not have
 * to run thirty real turns to reach the thirty-first.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/AgentService', () => ({ listAgents: vi.fn(async () => []), runAgentDeep: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { runAgentDeep } = await import('@/services/AgentService');
const { hit, RATE_LIMITS, resetMemoryRateLimits } = await import('@/libs/rateLimit');
const { POST } = await import('./route');

function signedInAs(userId: string) {
  vi.mocked(clerkAuth).mockResolvedValue({ userId, orgId: 'proj-ops', accountId: 'acct-northwind', projectId: 'proj-ops', role: 'member', workspaceRole: 'member', has: () => true });
}

function turn(ip: string) {
  return new Request('https://app.northwind.example/en/rpc/agent/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ message: 'Summarise the Kestrel renewal' }),
  });
}

beforeEach(() => {
  resetMemoryRateLimits();
  vi.mocked(runAgentDeep).mockClear();
});

describe('POST /rpc/agent/stream limits', () => {
  it('refuses a person\'s 31st turn in a minute with a 429 and Retry-After, before any model runs', async () => {
    signedInAs('usr-sam');
    for (let i = 0; i < RATE_LIMITS.chatPerUser.limit; i++) {
      expect((await hit(RATE_LIMITS.chatPerUser, 'usr-sam')).allowed).toBe(true);
    }

    const res = await POST(turn('198.51.100.4'));

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    await expect(res.json()).resolves.toMatchObject({ code: 'RATE_LIMITED' });
    expect(runAgentDeep).not.toHaveBeenCalled();
  });

  it('refuses an address past 120 turns a minute, whoever is signed in', async () => {
    for (let i = 0; i < RATE_LIMITS.chatPerIp.limit; i++) {
      await hit(RATE_LIMITS.chatPerIp, '203.0.113.7');
    }
    signedInAs('usr-kim');

    const res = await POST(turn('203.0.113.7'));

    expect(res.status).toBe(429);
    expect(runAgentDeep).not.toHaveBeenCalled();
  });
});
