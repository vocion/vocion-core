/**
 * The dev mail sink (`VOCION_MAIL_SINK_DIR`): a JSON copy of every message.
 *
 * Pinned: with mail on and no Resend settings the sink IS the transport;
 * with mail off nothing is delivered but the copy is still kept, marked
 * undelivered; with Resend configured, Resend delivers and the sink keeps a
 * copy marked so; and `mailTransportConfigured` — what the email sign-in link
 * asks before offering itself — counts the sink as somewhere for mail to go
 * only while mail is on.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mailTransportConfigured, sendMail } from './index';
import { mailSinkDir, readSink } from './sink';

const MESSAGE = { to: 'dana@northwind.example', subject: 'Join Northwind on Vocion', html: '<p>Join</p>', text: 'Join', tags: { kind: 'invite' } };

let sink: string;

beforeEach(async () => {
  sink = await mkdtemp(join(tmpdir(), 'vocion-mail-sink-'));
  for (const key of ['VOCION_MAIL_ENABLED', 'RESEND_API_KEY', 'VOCION_MAIL_FROM', 'VOCION_MAIL_SINK_DIR']) {
    vi.stubEnv(key, '');
  }
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(sink, { recursive: true, force: true });
});

describe('sendMail with the sink on', () => {
  it('is the transport when mail is on and Resend is not configured', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');
    vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);

    const result = await sendMail(MESSAGE);

    expect(result).toMatchObject({ skipped: false, provider: 'sink' });
    expect(result.skipped === false && result.id).toMatch(/\.json$/);

    const [kept] = await readSink(sink);

    expect(kept).toMatchObject({ to: ['dana@northwind.example'], subject: 'Join Northwind on Vocion', text: 'Join', html: '<p>Join</p>', tags: { kind: 'invite' }, delivered: 'sink' });
    expect(Number.isNaN(Date.parse(kept!.at))).toBe(false);
  });

  it('with mail off, delivers nothing but keeps the copy, marked undelivered', async () => {
    vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);

    await expect(sendMail(MESSAGE)).resolves.toEqual({ skipped: true, reason: 'disabled' });

    const [kept] = await readSink(sink);

    expect(kept).toMatchObject({ subject: 'Join Northwind on Vocion', delivered: false });
  });

  it('with Resend configured, Resend delivers and the sink keeps a copy', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');
    vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);
    vi.stubEnv('RESEND_API_KEY', 're_northwind');
    vi.stubEnv('VOCION_MAIL_FROM', 'Vocion <invites@northwind.example>');
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'msg_9' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(sendMail(MESSAGE)).resolves.toEqual({ skipped: false, provider: 'resend', id: 'msg_9' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [kept] = await readSink(sink);

    expect(kept).toMatchObject({ from: 'Vocion <invites@northwind.example>', delivered: 'resend' });
  });

  it('keeps messages oldest first, one file each', async () => {
    vi.stubEnv('VOCION_MAIL_ENABLED', '1');
    vi.stubEnv('VOCION_MAIL_SINK_DIR', sink);

    await sendMail({ ...MESSAGE, subject: 'first' });
    await sendMail({ ...MESSAGE, subject: 'second' });

    expect((await readSink(sink)).map(m => m.subject)).toEqual(['first', 'second']);
  });

  it('reads an empty or missing sink as no mail', async () => {
    await expect(readSink(join(sink, 'never-written'))).resolves.toEqual([]);
  });

  it('is off when unset, and resolves a relative directory', () => {
    expect(mailSinkDir({})).toBeNull();
    expect(mailSinkDir({ VOCION_MAIL_SINK_DIR: '  ' })).toBeNull();
    expect(mailSinkDir({ VOCION_MAIL_SINK_DIR: '.mail-sink' })).toMatch(/\/\.mail-sink$/);
  });
});

describe('mailTransportConfigured', () => {
  it('needs mail on, and Resend\'s key and sender or the sink', () => {
    const resend = { RESEND_API_KEY: 're_x', VOCION_MAIL_FROM: 'Vocion <a@northwind.example>' };

    expect(mailTransportConfigured({ VOCION_MAIL_ENABLED: '1', ...resend })).toBe(true);
    expect(mailTransportConfigured({ VOCION_MAIL_ENABLED: '1', VOCION_MAIL_SINK_DIR: '.mail-sink' })).toBe(true);
    expect(mailTransportConfigured({ VOCION_MAIL_ENABLED: '1', RESEND_API_KEY: 're_x' })).toBe(false);
    expect(mailTransportConfigured({ VOCION_MAIL_ENABLED: '1' })).toBe(false);
    expect(mailTransportConfigured({ ...resend, VOCION_MAIL_SINK_DIR: '.mail-sink' })).toBe(false);
    expect(mailTransportConfigured({ VOCION_MAIL_ENABLED: 'true', ...resend })).toBe(false);
  });
});
