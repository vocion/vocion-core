import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildResendBody, RESEND_ENDPOINT, sendViaResend } from './resend';

const ENV_KEYS = ['VOCION_MAIL_ENABLED', 'RESEND_API_KEY', 'VOCION_MAIL_FROM'] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = saved[k];
    }
  }
  vi.unstubAllGlobals();
});

async function mail() {
  return import('./index');
}

describe('libs/mail — the flag', () => {
  it('is off unless VOCION_MAIL_ENABLED is exactly "1"', async () => {
    const { mailEnabled } = await mail();

    expect(mailEnabled()).toBe(false);

    process.env.VOCION_MAIL_ENABLED = 'true';

    expect(mailEnabled()).toBe(false);

    process.env.VOCION_MAIL_ENABLED = '1';

    expect(mailEnabled()).toBe(true);
  });

  it('sendMail skips (does not throw, does not fetch) when disabled', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { sendMail } = await mail();
    const res = await sendMail({ to: 'a@example.com', subject: 's', html: '<p>x</p>' });

    expect(res).toEqual({ skipped: true, reason: 'disabled' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('assertMailEnabled throws a 501-shaped MailError when off', async () => {
    const { assertMailEnabled, MailError } = await mail();
    try {
      assertMailEnabled();
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(MailError);
      expect((e as InstanceType<typeof MailError>).code).toBe('DISABLED');
      expect((e as InstanceType<typeof MailError>).status).toBe(501);
    }
  });

  it('names the missing env when enabled but unconfigured', async () => {
    process.env.VOCION_MAIL_ENABLED = '1';
    process.env.RESEND_API_KEY = 're_x';
    const { sendMail } = await mail();

    await expect(sendMail({ to: 'a@example.com', subject: 's', html: '' })).rejects.toThrow(/VOCION_MAIL_FROM is not set/);
  });
});

describe('libs/mail — the Resend transport', () => {
  it('posts the exact body Resend accepts and returns the id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 })) as unknown as typeof fetch;
    const id = await sendViaResend({
      apiKey: 're_key',
      from: 'Vocion <reports@example.com>',
      message: { to: ['chris@example.com'], subject: 'Team report', html: '<p>hi</p>', text: 'hi', replyTo: 'ops@example.com', tags: { job: 'daily-team-report' } },
      fetchImpl,
    });

    expect(id).toBe('msg_1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;

    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_key');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Vocion <reports@example.com>',
      to: ['chris@example.com'],
      subject: 'Team report',
      html: '<p>hi</p>',
      text: 'hi',
      reply_to: 'ops@example.com',
      tags: [{ name: 'job', value: 'daily-team-report' }],
    });
  });

  it('omits optional fields it was not given', () => {
    expect(buildResendBody('f@example.com', { to: ['t@example.com'], subject: 's', html: 'h' })).toEqual({
      from: 'f@example.com',
      to: ['t@example.com'],
      subject: 's',
      html: 'h',
    });
  });

  it('turns a non-2xx into a PROVIDER MailError carrying the status and body', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"domain not verified"}', { status: 403 })) as unknown as typeof fetch;

    await expect(sendViaResend({ apiKey: 'k', from: 'f@example.com', message: { to: ['t@example.com'], subject: 's', html: 'h' }, fetchImpl }))
      .rejects
      .toMatchObject({ name: 'MailError', code: 'PROVIDER', status: 502, message: expect.stringContaining('403') });
  });

  it('sendMail wires env → transport when enabled', async () => {
    process.env.VOCION_MAIL_ENABLED = '1';
    process.env.RESEND_API_KEY = 're_live';
    process.env.VOCION_MAIL_FROM = 'Vocion <reports@example.com>';
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'msg_2' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { sendMail } = await mail();
    const res = await sendMail({ to: ['a@example.com', 'b@example.com'], subject: 's', html: '<p>x</p>' });

    expect(res).toEqual({ skipped: false, provider: 'resend', id: 'msg_2' });

    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

    expect(body.from).toBe('Vocion <reports@example.com>');
    expect(body.to).toEqual(['a@example.com', 'b@example.com']);
  });
});
