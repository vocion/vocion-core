/**
 * A brief's audio, on each way out of the app (docs/guides/listen-to-your-brief.md):
 *
 *   - Slack: the message, then the MP3 uploaded into the same DM
 *     (files.getUploadURLExternal + files.completeUploadExternal), so Slack
 *     draws its own player;
 *   - a text: an MMS whose MediaUrl is a signed link to the MP3, falling back
 *     to the words and the link when the number cannot take an MMS;
 *   - email: a "▶ Listen (m:ss)" button to the brief's page, and the MP3
 *     attached under the size threshold.
 *
 * And the push itself hands every channel the brief's audio when it has one.
 */
import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { briefingSchema, notificationSchema, rateLimitHitSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { setRhythm } = await import('@/services/personal/rhythm/schedule');
const { EMAIL_AUDIO_MAX_BYTES, pushEmail, pushToPerson } = await import('./push');
const { sendSlack } = await import('@/libs/notifications/slack');
const { sendSmsNotification } = await import('@/libs/notifications/sms');
const { sendSms } = await import('@/libs/surfaces/sms');
const { buildResendBody } = await import('@/libs/mail/resend');
const { ensureBriefAudio } = await import('@/services/briefings/audio/audio');
const { readClipToken } = await import('@/libs/briefings/listenLink');

const MP3 = new Uint8Array(Buffer.alloc(32_000, 0xFF));
const AUDIO = { bytes: MP3, filename: 'Your-day-Fri-Oct-9.mp3', title: 'Your day — Fri, Oct 9', durationMs: 134_000, clipUrl: 'https://app.vocion.example/api/listen/clip/tok.mp3' };
const MESSAGE = { title: 'Your day is ready', body: 'Good morning, Alex — two decisions on you.', url: 'https://app.vocion.example/w/alex/dashboard/briefings/7', stopUrl: 'https://app.vocion.example/api/personal/push/stop?t=x' };

describe('Slack: the MP3 as a file in the DM', () => {
  it('posts the message, then uploads the MP3 into the conversation it opened', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body });
      const reply = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
      if (url.endsWith('/users.lookupByEmail?email=alex%40northwind.example')) {
        return reply({ ok: true, user: { id: 'U0FIXTURE1' } });
      }
      if (url.endsWith('/chat.postMessage')) {
        return reply({ ok: true, channel: 'D0FIXTURE1', ts: '1.0' });
      }
      if (url.endsWith('/files.getUploadURLExternal')) {
        return reply({ ok: true, upload_url: 'https://files.slack.example/upload/1', file_id: 'F0FIXTURE1' });
      }
      if (url === 'https://files.slack.example/upload/1') {
        return new Response('OK', { status: 200 });
      }
      if (url.endsWith('/files.completeUploadExternal')) {
        return reply({ ok: true });
      }
      return new Response('nope', { status: 404 });
    });
    const out = await sendSlack({ dmEmail: 'alex@northwind.example' }, { id: 0, kind: 'personal-push', title: 'Your day is ready', body: 'Two decisions.', url: MESSAGE.url }, 'xoxb-fixture', { fetchImpl: fetchImpl as never, baseUrl: 'https://slack.example/api', file: { filename: AUDIO.filename, title: AUDIO.title, bytes: MP3 } });

    expect(out).toEqual({ status: 'sent' });
    expect(calls.map(c => c.url.replace('https://slack.example/api/', ''))).toEqual([
      'users.lookupByEmail?email=alex%40northwind.example',
      'chat.postMessage',
      'files.getUploadURLExternal',
      'https://files.slack.example/upload/1',
      'files.completeUploadExternal',
    ]);
    expect(String(calls[2]!.body)).toContain(`filename=${AUDIO.filename}`);
    expect(String(calls[2]!.body)).toContain(`length=${MP3.byteLength}`);
    expect(JSON.parse(String(calls[4]!.body))).toEqual({ files: [{ id: 'F0FIXTURE1', title: AUDIO.title }], channel_id: 'D0FIXTURE1' });
  });

  it('a missing files:write still sends the message', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const reply = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
      if (url.includes('lookupByEmail')) {
        return reply({ ok: true, user: { id: 'U0FIXTURE1' } });
      }
      if (url.endsWith('/chat.postMessage')) {
        return reply({ ok: true, channel: 'D0FIXTURE1' });
      }
      return reply({ ok: false, error: 'missing_scope' });
    });
    const out = await sendSlack({ dmEmail: 'alex@northwind.example' }, { id: 0, kind: 'k', title: 't', body: 'b', url: null }, 'xoxb-fixture', { fetchImpl: fetchImpl as never, baseUrl: 'https://slack.example/api', file: { filename: 'a.mp3', title: 'a', bytes: MP3 } });

    expect(out).toEqual({ status: 'sent', fileError: 'missing_scope' });
  });
});

describe('a text: the MP3 as an MMS, else the link', () => {
  it('Twilio is sent MediaUrl with the words and the link', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACfixture');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'fixture-token');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sid: 'SMfixture' }), { status: 201 }));
    await sendSms('+15555550101', '+15555550100', 'Your day is ready', fetchImpl as never, AUDIO.clipUrl);

    const form = new URLSearchParams(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));

    expect(Object.fromEntries(form)).toEqual({ From: '+15555550101', To: '+15555550100', Body: 'Your day is ready', MediaUrl: AUDIO.clipUrl });

    vi.unstubAllEnvs();
  });

  it('attaches the MP3, and falls back to link-only when MMS is refused', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACfixture');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'fixture-token');
    const message = { id: 0, kind: 'personal-push', title: 'Your day is ready', body: 'Listen (2:14) at the link.', url: MESSAGE.url };

    const ok = vi.fn(async () => ({}));

    await expect(sendSmsNotification({ from: '+15555550101', to: '+15555550100' }, message, ok, { url: AUDIO.clipUrl })).resolves.toEqual({ status: 'sent', media: 'attached' });
    expect(ok).toHaveBeenCalledWith('+15555550101', '+15555550100', expect.stringContaining(MESSAGE.url), AUDIO.clipUrl);

    const refuses = vi.fn(async (_f: string, _t: string, _b: string, media?: string) => {
      if (media) {
        throw new Error('Twilio did not take the text: MMS is not supported for this number');
      }
      return {};
    });

    await expect(sendSmsNotification({ from: '+15555550101', to: '+15555550100' }, message, refuses, { url: AUDIO.clipUrl })).resolves.toEqual({ status: 'sent', media: 'link_only' });
    expect(refuses).toHaveBeenCalledTimes(2);
    expect(refuses.mock.calls[1]).toEqual(['+15555550101', '+15555550100', expect.stringContaining(MESSAGE.url)]);

    vi.unstubAllEnvs();
  });
});

describe('email: a Listen button, and the MP3 attached when small', () => {
  it('draws "▶ Listen (2:14)" linking to the brief\'s page with the player', () => {
    const mail = pushEmail({ ...MESSAGE, audio: AUDIO });

    expect(mail.html).toContain('▶ Listen (2:14)');
    expect(mail.html).toContain(`href="${MESSAGE.url}?listen=1"`);
    expect(mail.text).toContain(`Listen (2:14): ${MESSAGE.url}?listen=1`);
    expect(mail.attachments).toEqual([{ filename: AUDIO.filename, content: MP3, contentType: 'audio/mpeg' }]);
  });

  it('no audio, no button; a large file is linked, not attached', () => {
    expect(pushEmail(MESSAGE).html).not.toContain('Listen');

    const big = pushEmail({ ...MESSAGE, audio: { ...AUDIO, bytes: new Uint8Array(EMAIL_AUDIO_MAX_BYTES + 1) } });

    expect(big.html).toContain('▶ Listen');
    expect(big.attachments).toBeUndefined();
  });

  it('Resend is sent the attachment as base64', () => {
    const body = buildResendBody('Vocion <brief@vocion.example>', { to: ['alex@northwind.example'], subject: 's', html: '<p/>', attachments: [{ filename: 'a.mp3', content: new Uint8Array([1, 2, 3]), contentType: 'audio/mpeg' }] });

    expect(body.attachments).toEqual([{ filename: 'a.mp3', content: 'AQID', content_type: 'audio/mpeg' }]);
  });
});

describe('the push carries the brief\'s audio to every channel', () => {
  const ACCOUNT = 'acct-pushaudio-northwind';
  const ALEX = 'usr-pushaudio-alex';
  let dir: string;

  beforeAll(async () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'push-audio-secret';
    dir = await mkdtemp(path.join(tmpdir(), 'push-audio-'));
    process.env.VOCION_ARTIFACTS_DIR = dir;
    await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-pushaudio' });
    await db.insert(userSchema).values({ id: ALEX, email: 'alex.audio@northwind.example', name: 'Alex Rivera', phone: '+15555550100' });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the MP3 once and hands Slack, text and email the file and a signed clip link', async () => {
    const now = new Date('2026-10-09T14:31:00Z');
    const home = await ensurePersonalProject(ALEX, ACCOUNT);
    await db.delete(notificationSchema);
    await db.delete(rateLimitHitSchema);
    await setRhythm(ALEX, ACCOUNT, { timeZone: 'America/Los_Angeles', pushChannels: ['slack', 'sms', 'email'] }, now);
    const [{ id }] = await db.insert(briefingSchema).values({ orgId: home.id, title: 'Your day — Fri, Oct 9', content: 'Two decisions on you.', publishedBy: 'job:personal-brief' }).returning({ id: briefingSchema.id }) as [{ id: number }];
    const voice = {
      connector: 'elevenlabs',
      label: 'ElevenLabs',
      defaultVoice: { id: 'voice_default_01', name: 'Brian' },
      scriptModel: 'eleven_multilingual_v2',
      listVoices: async () => ({ ok: true as const, voices: [] }),
      speak: async () => ({ ok: true as const, audio: Buffer.from(MP3), contentType: 'audio/mpeg' as const, characters: 40, durationMs: 4_000 }),
    };
    await ensureBriefAudio({ orgId: home.id, briefingId: id, wait: true }, { voice, script: async () => 'Good morning, Alex. Two decisions are on you.', dir: path.join(dir, 'media'), bucket: null, now });

    const got: Array<{ channel: string; audio: unknown }> = [];
    const rec = (channel: string) => async (_to: unknown, m: { audio?: unknown }) => {
      got.push({ channel, audio: m.audio });
      return 'sent';
    };
    const out = await pushToPerson({ userId: ALEX, accountId: ACCOUNT, kind: 'brief', key: 'brief:audio-test', title: 'Your day is ready', body: 'Two decisions.', path: `/dashboard/briefings/${id}`, workspaceSlug: home.slug, audio: { orgId: home.id, briefingId: id } }, { now, senders: { slack: rec('slack'), sms: rec('sms'), email: rec('email') } });

    expect(out.pushed).toBe(true);
    expect(got.map(g => g.channel)).toEqual(['slack', 'sms', 'email']);

    for (const g of got) {
      expect(g.audio).toMatchObject({ filename: 'Your-day-Fri-Oct-9.mp3', durationMs: 4_000, title: 'Your day — Fri, Oct 9' });
    }
    const clip = (got[1]!.audio as { clipUrl: string }).clipUrl;
    const token = clip.split('/clip/')[1]!;

    expect(readClipToken(token, now.getTime())).toEqual({ orgId: home.id, briefingId: id, exp: now.getTime() + 24 * 60 * 60 * 1000 });

    const [n] = await db.select().from(notificationSchema).where(eq(notificationSchema.userId, ALEX));

    expect(n?.kind).toBe('personal-brief');
  });
});
