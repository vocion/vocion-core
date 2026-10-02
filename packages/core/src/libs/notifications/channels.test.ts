import type { ApnsRequest } from './apns';
import type { NotificationMessage } from './outcome';
import { Buffer } from 'node:buffer';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { apnsConfig, apnsProviderToken, sendApns } from './apns';
import { sendSlack, slackText } from './slack';
import { sendWebPush, vapidConfig } from './webPush';

// Every key here is generated for the test and every token is made up.
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const CONFIG = { key: PEM, keyId: 'KEYID00001', teamId: 'TEAMID0001', bundleId: 'app.example.vocion' };
const DEVICE = { token: 'ab'.repeat(32), environment: 'production', bundleId: 'app.example.vocion' };
const MESSAGE: NotificationMessage = { id: 7, kind: 'released', title: 'Released: Light theme toggle is live', body: 'Live in Northwind.', url: 'https://app.example.com/w/northwind/dashboard/p/releases/12' };

const b64urlDecode = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

describe('APNs', () => {
  it('reads its identity from the environment, or reports none', () => {
    expect(apnsConfig({})).toBeNull();
    expect(apnsConfig({ VOCION_APNS_KEY: 'k', VOCION_APNS_KEY_ID: 'i', VOCION_APNS_TEAM_ID: 't' })).toBeNull();
    expect(apnsConfig({ VOCION_APNS_KEY: 'line1\\nline2', VOCION_APNS_KEY_ID: 'i', VOCION_APNS_TEAM_ID: 't', VOCION_APNS_BUNDLE_ID: 'b' })?.key).toBe('line1\nline2');
  });

  it('signs an ES256 provider token Apple can verify with the key', () => {
    const token = apnsProviderToken(CONFIG, Date.UTC(2026, 8, 30));
    const [h, c, sig] = token.split('.');

    expect(JSON.parse(b64urlDecode(h!).toString())).toEqual({ alg: 'ES256', kid: 'KEYID00001' });
    expect(JSON.parse(b64urlDecode(c!).toString())).toEqual({ iss: 'TEAMID0001', iat: Math.floor(Date.UTC(2026, 8, 30) / 1000) });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key: createPublicKey(PEM), dsaEncoding: 'ieee-p1363' }, b64urlDecode(sig!))).toBe(true);
  });

  it('posts an alert to the device on the production host, and reads 200 as sent', async () => {
    const transport = vi.fn(async (_req: ApnsRequest) => ({ status: 200, body: '' }));

    expect(await sendApns(DEVICE, MESSAGE, CONFIG, transport)).toEqual({ status: 'sent' });

    const req = transport.mock.calls[0]![0];

    expect(req.host).toBe('api.push.apple.com');
    expect(req.path).toBe(`/3/device/${DEVICE.token}`);
    expect(req.headers['apns-topic']).toBe('app.example.vocion');
    expect(req.headers.authorization).toMatch(/^bearer ey/);
    expect(JSON.parse(req.body)).toMatchObject({ aps: { alert: { title: MESSAGE.title, body: MESSAGE.body } }, url: MESSAGE.url });
  });

  it('uses the sandbox for a development build', async () => {
    const transport = vi.fn(async (_req: ApnsRequest) => ({ status: 200, body: '' }));
    await sendApns({ ...DEVICE, environment: 'sandbox' }, MESSAGE, CONFIG, transport);

    expect(transport.mock.calls[0]![0].host).toBe('api.sandbox.push.apple.com');
  });

  it('calls a dead token gone, a 5xx a retry, and says "not configured" without a key', async () => {
    expect((await sendApns(DEVICE, MESSAGE, CONFIG, async () => ({ status: 410, body: '{"reason":"Unregistered"}' }))).status).toBe('gone');
    expect((await sendApns(DEVICE, MESSAGE, CONFIG, async () => ({ status: 400, body: '{"reason":"BadDeviceToken"}' }))).status).toBe('gone');
    expect((await sendApns(DEVICE, MESSAGE, CONFIG, async () => ({ status: 503, body: '' }))).status).toBe('retry');
    expect((await sendApns(DEVICE, MESSAGE, CONFIG, async () => {
      throw new Error('ECONNRESET');
    })).status).toBe('retry');
    expect((await sendApns(DEVICE, MESSAGE, CONFIG, async () => ({ status: 400, body: '{"reason":"PayloadTooLarge"}' }))).status).toBe('failed');

    const none = await sendApns(DEVICE, MESSAGE, null);

    expect(none.status).toBe('not_configured');
    expect(none.status === 'not_configured' && none.error).toMatch(/VOCION_APNS_KEY/);
  });

  it('refuses a device registered for another app', async () => {
    const out = await sendApns({ ...DEVICE, bundleId: 'app.example.other' }, MESSAGE, CONFIG, async () => ({ status: 200, body: '' }));

    expect(out.status).toBe('failed');
  });
});

describe('Web Push', () => {
  const SUB = { endpoint: 'https://push.example.com/sub/abc', keys: { p256dh: 'p', auth: 'a' } };
  const VAPID = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:ops@example.com' };

  it('reads VAPID from the environment, or reports none', () => {
    expect(vapidConfig({})).toBeNull();
    expect(vapidConfig({ VOCION_VAPID_PUBLIC_KEY: 'a', VOCION_VAPID_PRIVATE_KEY: 'b', NEXT_PUBLIC_APP_URL: 'https://app.example.com/' })).toEqual({ publicKey: 'a', privateKey: 'b', subject: 'https://app.example.com' });
    // An http:// app URL is not a contact the push services accept.
    expect(vapidConfig({ VOCION_VAPID_PUBLIC_KEY: 'a', VOCION_VAPID_PRIVATE_KEY: 'b', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })?.subject).toMatch(/^mailto:/);
  });

  it('sends the payload the service worker reads', async () => {
    const send = vi.fn(async () => ({ statusCode: 201, body: '', headers: {} }));

    expect(await sendWebPush(SUB, MESSAGE, VAPID, send as never)).toEqual({ status: 'sent' });

    const [sub, payload, options] = send.mock.calls[0] as unknown as [unknown, string, { vapidDetails: unknown }];

    expect(sub).toEqual(SUB);
    expect(JSON.parse(payload)).toEqual({ id: 7, kind: 'released', title: MESSAGE.title, body: MESSAGE.body, url: MESSAGE.url });
    expect(options.vapidDetails).toEqual({ subject: VAPID.subject, publicKey: 'pub', privateKey: 'priv' });
  });

  it('calls an expired subscription gone and a 5xx a retry', async () => {
    const fail = (statusCode: number) => async () => {
      throw Object.assign(new Error('push failed'), { statusCode });
    };

    expect((await sendWebPush(SUB, MESSAGE, VAPID, fail(410) as never)).status).toBe('gone');
    expect((await sendWebPush(SUB, MESSAGE, VAPID, fail(404) as never)).status).toBe('gone');
    expect((await sendWebPush(SUB, MESSAGE, VAPID, fail(502) as never)).status).toBe('retry');
    expect((await sendWebPush(SUB, MESSAGE, VAPID, fail(400) as never)).status).toBe('failed');
    expect((await sendWebPush(SUB, MESSAGE, null)).status).toBe('not_configured');
  });
});

describe('Slack', () => {
  it('finds the person by email and DMs them', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('users.lookupByEmail')) {
        expect(u).toContain('email=riley%40northwind.example');

        return new Response(JSON.stringify({ ok: true, user: { id: 'U0FICTION' } }));
      }
      return new Response(JSON.stringify({ ok: true, ts: '1.2' }));
    });

    expect(await sendSlack({ dmEmail: 'riley@northwind.example' }, MESSAGE, 'xoxb-test', { fetchImpl: fetchImpl as never, baseUrl: 'https://slack.example' })).toEqual({ status: 'sent' });

    const post = fetchImpl.mock.calls[1] as unknown as [string, { body: string }];

    expect(post[0]).toBe('https://slack.example/chat.postMessage');
    expect(JSON.parse(post[1].body)).toMatchObject({ channel: 'U0FICTION', text: slackText(MESSAGE) });
  });

  it('says why when the person is not in Slack, and "not configured" without a token', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'users_not_found' })));
    const out = await sendSlack({ dmEmail: 'nobody@northwind.example' }, MESSAGE, 'xoxb-test', { fetchImpl: fetchImpl as never });

    expect(out.status).toBe('failed');
    expect((await sendSlack({ channelId: 'C0FICTION' }, MESSAGE, null)).status).toBe('not_configured');
  });
});
