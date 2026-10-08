/**
 * Sign-up (accepting an invite as a new user) is capped per address, so a
 * script cannot sweep invite tokens. Real PGlite, so the shared counter is
 * the one production uses; the rest of the route is covered in `route.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ hashPassword: vi.fn(async () => 'hashed') }));

const { db } = await import('@/libs/DB');
const { RATE_LIMITS } = await import('@/libs/rateLimit');
const { rateLimitHitSchema } = await import('@/models/Schema');
const { POST } = await import('./route');

function signup(ip: string) {
  return new Request('https://app.northwind.example/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ name: 'Lee', email: 'lee@northwind.example', password: 'password123', inviteToken: 'not-a-token' }),
  });
}

beforeEach(async () => {
  await db.delete(rateLimitHitSchema);
});

describe('POST /api/signup rate limit', () => {
  it('answers the eleventh attempt in an hour from one address with a 429', async () => {
    for (let i = 0; i < RATE_LIMITS.signUpPerIp.limit; i++) {
      expect((await POST(signup('198.51.100.4'))).status).toBe(404);
    }

    const res = await POST(signup('198.51.100.4'));

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await POST(signup('198.51.100.5'))).status).toBe(404);
  });
});
