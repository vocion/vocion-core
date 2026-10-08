/**
 * A password sign-in is checked against the address's limit and the email's
 * lockout before Auth.js sees it, and a refusal is a 429 with `Retry-After`
 * whose body still carries the `url` the next-auth client reads.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const authPost = vi.fn(async (_req: Request) => Response.json({ url: 'https://app.northwind.example/dashboard' }));
vi.mock('@/libs/Auth', () => ({ handlers: { GET: vi.fn(), POST: (req: Request) => authPost(req) } }));

const { db } = await import('@/libs/DB');
const { hit, RATE_LIMITS, resetMemoryRateLimits } = await import('@/libs/rateLimit');
const { rateLimitHitSchema } = await import('@/models/Schema');
const { POST } = await import('./route');

function credentialsPost(email: string, ip = '198.51.100.4') {
  return new NextRequest('https://app.northwind.example/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
    body: new URLSearchParams({ email, password: 'whatever', csrfToken: 'csrf' }),
  });
}

beforeEach(async () => {
  authPost.mockClear();
  resetMemoryRateLimits();
  await db.delete(rateLimitHitSchema);
});

describe('POST /api/auth/[...nextauth]', () => {
  it('hands an ordinary sign-in to Auth.js with its body intact', async () => {
    const res = await POST(credentialsPost('sam@northwind.example'));

    expect(res.status).toBe(200);
    expect(authPost).toHaveBeenCalledTimes(1);

    const forwarded = await authPost.mock.calls[0]![0].formData();

    expect(forwarded.get('email')).toBe('sam@northwind.example');
  });

  it('answers a locked email with a 429 the sign-in form can read', async () => {
    for (let i = 0; i < RATE_LIMITS.signInFailuresPerAccount.limit; i++) {
      await hit(RATE_LIMITS.signInFailuresPerAccount, 'sam@northwind.example');
    }

    const res = await POST(credentialsPost('Sam@Northwind.example'));

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);

    const body = await res.json();

    expect(new URL(body.url).searchParams.get('code')).toBe('rate_limited');
    expect(authPost).not.toHaveBeenCalled();
  });

  it('caps password attempts from one address', async () => {
    for (let i = 0; i < RATE_LIMITS.signInPerIp.limit; i++) {
      await hit(RATE_LIMITS.signInPerIp, '198.51.100.4');
    }

    expect((await POST(credentialsPost('kim@northwind.example'))).status).toBe(429);
    expect((await POST(credentialsPost('kim@northwind.example', '198.51.100.5'))).status).toBe(200);
  });

  it('leaves every other Auth.js POST alone', async () => {
    for (let i = 0; i < RATE_LIMITS.signInPerIp.limit + 1; i++) {
      await hit(RATE_LIMITS.signInPerIp, '198.51.100.4');
    }
    const signOut = new NextRequest('https://app.northwind.example/api/auth/signout', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.4' },
    });

    expect((await POST(signOut)).status).toBe(200);
  });
});
