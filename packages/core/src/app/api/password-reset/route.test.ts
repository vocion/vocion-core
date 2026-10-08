/**
 * The forgot-password routes over real rows: the request answers the same for
 * every email, the check says whether a link is live without spending it, the
 * confirm spends a link once, and each answers a flood with a 429 and
 * `Retry-After`.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const sendMail = vi.fn(async (_message: { text?: string }) => ({ skipped: false as const, provider: 'resend' as const, id: 'msg-1' }));
vi.mock('@/libs/mail', () => ({ sendMail: (message: { text?: string }) => sendMail(message) }));
vi.mock('@/libs/Auth', () => ({}));

const { db } = await import('@/libs/DB');
const { verifyPassword } = await import('@/libs/identity/password');
const { resetMemoryRateLimits } = await import('@/libs/rateLimit');
const { passwordResetTokenSchema, rateLimitHitSchema, userSchema } = await import('@/models/Schema');
const { POST: requestReset } = await import('./route');
const { POST: confirmReset } = await import('./confirm/route');
const { POST: checkReset } = await import('./check/route');

function json(url: string, body: unknown, ip = '198.51.100.4') {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) });
}

/** Let the deferred issue-and-mail step finish. */
async function settle() {
  for (let i = 0; i < 20 && sendMail.mock.calls.length === 0; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

beforeEach(async () => {
  sendMail.mockClear();
  resetMemoryRateLimits();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.northwind.example');
  await db.delete(rateLimitHitSchema);
  await db.delete(passwordResetTokenSchema);
  await db.delete(userSchema);
  await db.insert(userSchema).values({ id: 'usr-sam', email: 'sam@northwind.example', name: 'Sam' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/password-reset', () => {
  it('answers a known and an unknown email with the same body', async () => {
    const known = await requestReset(json('https://app.northwind.example/api/password-reset', { email: 'sam@northwind.example' }));
    const unknown = await requestReset(json('https://app.northwind.example/api/password-reset', { email: 'nobody@northwind.example' }));

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
  });

  it('refuses a body with no email', async () => {
    const res = await requestReset(json('https://app.northwind.example/api/password-reset', { email: 'not an email' }));

    expect(res.status).toBe(400);
  });

  it('answers the fourth request in an hour about one email with a 429', async () => {
    for (let i = 0; i < 3; i++) {
      await requestReset(json('https://app.northwind.example/api/password-reset', { email: 'sam@northwind.example' }, `198.51.100.${i}`));
    }

    const res = await requestReset(json('https://app.northwind.example/api/password-reset', { email: 'sam@northwind.example' }, '198.51.100.9'));

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});

describe('POST /api/password-reset/check', () => {
  it('says a mailed link is live without spending it, and a made-up one is not', async () => {
    await requestReset(json('https://app.northwind.example/api/password-reset', { email: 'sam@northwind.example' }));
    await settle();
    const token = decodeURIComponent(/#token=(\S+)/.exec(sendMail.mock.calls[0]![0].text ?? '')![1]!);

    const live = await checkReset(json('https://app.northwind.example/api/password-reset/check', { token }));
    const made = await checkReset(json('https://app.northwind.example/api/password-reset/check', { token: 'made-up' }));

    await expect(live.json()).resolves.toEqual({ live: true });
    await expect(made.json()).resolves.toEqual({ live: false });
    expect((await confirmReset(json('https://app.northwind.example/api/password-reset/confirm', { token, password: 'a-new-password' }))).status).toBe(200);
  });

  it('shares the per-address budget with the confirm — both are a way to try a token', async () => {
    for (let i = 0; i < 20; i++) {
      await checkReset(json('https://app.northwind.example/api/password-reset/check', { token: `guess-${i}` }));
    }

    const res = await confirmReset(json('https://app.northwind.example/api/password-reset/confirm', { token: 'guess-21', password: 'a-new-password' }));

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});

describe('POST /api/password-reset/confirm', () => {
  it('sets the password from a mailed link, once', async () => {
    await requestReset(json('https://app.northwind.example/api/password-reset', { email: 'sam@northwind.example' }));
    await settle();
    const token = decodeURIComponent(/token=(\S+)/.exec(sendMail.mock.calls[0]![0].text ?? '')![1]!);

    const first = await confirmReset(json('https://app.northwind.example/api/password-reset/confirm', { token, password: 'a-new-password' }));
    const again = await confirmReset(json('https://app.northwind.example/api/password-reset/confirm', { token, password: 'another-password' }));

    expect(first.status).toBe(200);
    expect(again.status).toBe(400);
    await expect(again.json()).resolves.toMatchObject({ code: 'INVALID_LINK' });

    const [user] = await db.select().from(userSchema).where(eq(userSchema.id, 'usr-sam'));

    expect(await verifyPassword('a-new-password', user!.passwordHash!)).toBe(true);
  });

  it('caps guesses at reset links from one address', async () => {
    for (let i = 0; i < 20; i++) {
      await confirmReset(json('https://app.northwind.example/api/password-reset/confirm', { token: `guess-${i}`, password: 'a-new-password' }));
    }

    const res = await confirmReset(json('https://app.northwind.example/api/password-reset/confirm', { token: 'guess-21', password: 'a-new-password' }));

    expect(res.status).toBe(429);
  });
});
