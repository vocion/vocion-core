/**
 * "Email me a sign-in link": offered only with mail configured, mailed only
 * to a login or a pending invite (and the asker cannot tell which), limited
 * the same for every address, and built on this deployment's own address
 * with the token in a fragment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/mail', () => ({
  sendMail: vi.fn(async () => ({ skipped: false, provider: 'resend', id: 'msg-1' })),
}));

const { db } = await import('@/libs/DB');
const { sendMail } = await import('@/libs/mail');
const { inviteSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const {
  configuredOrigin,
  deliverSignInLink,
  emailLinkConfigured,
  emailLinkProvider,
  FixedWindowLimiter,
  forwardedClientIp,
  linkRequestAnswer,
  mailedLinkFor,
  signInLinkMail,
} = await import('./emailLink');
const { callbackPathFromFragment } = await import('./emailLinkFragment');

const MAIL = { VOCION_MAIL_ENABLED: '1', RESEND_API_KEY: 're_northwind', VOCION_MAIL_FROM: 'Vocion <signin@northwind.example>' };
const AUTH_URL = 'https://evil.example/api/auth/callback/email?callbackUrl=https%3A%2F%2Fapp.northwind.example%2Fdashboard&token=tok123&email=dana%40northwind.example';

describe('emailLinkConfigured', () => {
  it('is on only with mail enabled, a key and a sender', () => {
    expect(emailLinkConfigured({ ...MAIL, NODE_ENV: 'development' })).toBe(true);
    expect(emailLinkConfigured({ ...MAIL, VOCION_MAIL_ENABLED: undefined, NODE_ENV: 'development' })).toBe(false);
    expect(emailLinkConfigured({ ...MAIL, RESEND_API_KEY: ' ', NODE_ENV: 'development' })).toBe(false);
    expect(emailLinkConfigured({ ...MAIL, VOCION_MAIL_FROM: undefined, NODE_ENV: 'development' })).toBe(false);
  });

  it('needs the deployment\'s own address in production', () => {
    expect(emailLinkConfigured({ ...MAIL, NODE_ENV: 'production' })).toBe(false);
    expect(emailLinkConfigured({ ...MAIL, NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://app.northwind.example' })).toBe(true);
    expect(emailLinkConfigured({ ...MAIL, NODE_ENV: 'production', AUTH_URL: 'https://app.northwind.example' })).toBe(true);
  });
});

describe('the mailed link', () => {
  it('opens the landing page on the configured address — never the request\'s Host — with the token in the fragment', () => {
    const link = mailedLinkFor(AUTH_URL, { NEXT_PUBLIC_APP_URL: 'https://app.northwind.example/', NODE_ENV: 'production' });

    expect(link).toBe('https://app.northwind.example/sign-in/email-link#token=tok123&email=dana%40northwind.example&callbackUrl=https%3A%2F%2Fapp.northwind.example%2Fdashboard');
  });

  it('is not built in production without a configured address', () => {
    expect(mailedLinkFor(AUTH_URL, { NODE_ENV: 'production' })).toBeNull();
    expect(configuredOrigin({ NEXT_PUBLIC_APP_URL: 'not a url' })).toBeNull();
  });

  it('falls back to the request\'s address in development', () => {
    expect(mailedLinkFor(AUTH_URL, { NODE_ENV: 'development' })).toMatch(/^https:\/\/evil\.example\/sign-in\/email-link#/);
  });

  it('round-trips through the landing page to Auth.js\'s own callback only', () => {
    const link = mailedLinkFor(AUTH_URL, { NEXT_PUBLIC_APP_URL: 'https://app.northwind.example' })!;

    expect(callbackPathFromFragment(new URL(link).hash)).toEqual({
      path: '/api/auth/callback/email?token=tok123&email=dana%40northwind.example&callbackUrl=https%3A%2F%2Fapp.northwind.example%2Fdashboard',
      email: 'dana@northwind.example',
    });
    expect(callbackPathFromFragment('#email=dana%40northwind.example')).toBeNull();
    expect(callbackPathFromFragment('')).toBeNull();
  });

  it('says what it is, how long it works, and what to do if you did not ask', () => {
    const mail = signInLinkMail('https://app.northwind.example/sign-in/email-link#token=t');

    expect(mail.subject).toBe('Your Vocion sign-in link');
    expect(mail.text).toContain('works once, for 15 minutes');
    expect(mail.text).toContain('If you did not ask for it, ignore this email');
  });

  it('is single-use for fifteen minutes (Auth.js deletes the token on use and checks its expiry)', () => {
    expect(emailLinkProvider()).toMatchObject({ id: 'email', type: 'email', maxAge: 15 * 60 });
  });
});

describe('limits', () => {
  it('allows three links per window and then says how long to wait', () => {
    const limiter = new FixedWindowLimiter(3, 60_000);

    expect(limiter.hit('dana@northwind.example', 0).allowed).toBe(true);
    expect(limiter.hit('dana@northwind.example', 1).allowed).toBe(true);
    expect(limiter.hit('dana@northwind.example', 2).allowed).toBe(true);
    expect(limiter.hit('dana@northwind.example', 3)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(limiter.hit('sam@northwind.example', 3).allowed).toBe(true);
    expect(limiter.hit('dana@northwind.example', 60_000).allowed).toBe(true);
  });

  it('answers the fourth request for any address — known or not — with the page that says to wait', () => {
    const answers = [0, 1, 2, 3].map(i => linkRequestAnswer({ email: 'nobody@acme.example', ip: null, now: 1_000_000 + i }));

    expect(answers.slice(0, 3)).toEqual([true, true, true]);
    expect(answers[3]).toBe('/sign-in?error=EmailLinkRateLimited&retryAfter=900');
  });

  it('limits one network across many addresses', () => {
    const results = Array.from({ length: 11 }, (_, i) => linkRequestAnswer({ email: `person${i}@acme.example`, ip: '198.51.100.7', now: 5_000_000 }));

    expect(results.filter(r => r === true)).toHaveLength(10);
  });

  it('reads the caller from the hop the nearest proxy appended', () => {
    expect(forwardedClientIp(new Headers({ 'x-forwarded-for': '203.0.113.9, 198.51.100.7' }))).toBe('198.51.100.7');
    expect(forwardedClientIp(new Headers({ 'x-real-ip': '198.51.100.8' }))).toBe('198.51.100.8');
    expect(forwardedClientIp(new Headers())).toBeNull();
  });
});

describe('deliverSignInLink — invite-only, without telling', () => {
  beforeEach(async () => {
    vi.mocked(sendMail).mockClear();
    await db.delete(inviteSchema);
    await db.delete(userSchema);
    await db.delete(tenantAccountSchema);
    await db.insert(tenantAccountSchema).values({ id: 'acct-northwind', name: 'Northwind', slug: 'northwind' });
    await db.insert(userSchema).values({ id: 'usr-sam', email: 'sam@northwind.example' });
    await db.insert(inviteSchema).values({ id: 'inv-dana', accountId: 'acct-northwind', email: 'dana@northwind.example', role: 'member', token: 'tok-dana', expiresAt: new Date(Date.now() + 86_400_000) });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('mails a login', async () => {
    await expect(deliverSignInLink({ email: 'sam@northwind.example', link: 'https://app.northwind.example/sign-in/email-link#t' })).resolves.toBe('sent');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'sam@northwind.example', subject: 'Your Vocion sign-in link' }));
  });

  it('mails a pending invite', async () => {
    await expect(deliverSignInLink({ email: 'dana@northwind.example', link: 'https://app.northwind.example/sign-in/email-link#t' })).resolves.toBe('sent');
  });

  it('mails nobody else', async () => {
    await expect(deliverSignInLink({ email: 'mallory@acme.example', link: 'https://app.northwind.example/sign-in/email-link#t' })).resolves.toBe('not-eligible');
    expect(sendMail).not.toHaveBeenCalled();
  });
});
