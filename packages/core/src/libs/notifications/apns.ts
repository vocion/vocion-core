import type { ChannelOutcome, NotificationMessage } from './outcome';
import { Buffer } from 'node:buffer';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import http2 from 'node:http2';
import process from 'node:process';

/**
 * PUSH TO THE iOS APP (backlog 048) — APNs over HTTP/2 with a token-based
 * (`.p8`) key. The key identifies the Vocion app to Apple, so it is the
 * deployment's, read from the environment; the parent project's deploy puts
 * the SSM parameters there (vocion-ios `PUSH-SETUP.md`):
 *
 *   VOCION_APNS_KEY        ← /vocion/push/apns/key        the `.p8` file's contents (PEM)
 *   VOCION_APNS_KEY_ID     ← /vocion/push/apns/key-id     10 characters
 *   VOCION_APNS_TEAM_ID    ← /vocion/push/apns/team-id    10 characters
 *   VOCION_APNS_BUNDLE_ID  ← /vocion/push/apns/bundle-id  the app's bundle id, the push topic
 *
 * With any of them unset the channel reports "not configured" and the other
 * channels go on. The key is never logged and never leaves this module.
 */

export type ApnsConfig = { key: string; keyId: string; teamId: string; bundleId: string };

/**
 * The APNs identity, or null when the deployment has none.
 * @param env
 */
export function apnsConfig(env: Record<string, string | undefined> = process.env): ApnsConfig | null {
  // A PEM pasted into a one-line env var arrives with literal `\n`.
  const key = (env.VOCION_APNS_KEY ?? '').replace(/\\n/g, '\n').trim();
  const keyId = env.VOCION_APNS_KEY_ID?.trim() ?? '';
  const teamId = env.VOCION_APNS_TEAM_ID?.trim() ?? '';
  const bundleId = env.VOCION_APNS_BUNDLE_ID?.trim() ?? '';
  if (!key || !keyId || !teamId || !bundleId) {
    return null;
  }
  return { key, keyId, teamId, bundleId };
}

/** The names a deploy must set, for the "not configured" line. */
export const APNS_ENV_NAMES = ['VOCION_APNS_KEY', 'VOCION_APNS_KEY_ID', 'VOCION_APNS_TEAM_ID', 'VOCION_APNS_BUNDLE_ID'] as const;

const b64url = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * Apple wants the provider token refreshed at most every 20 minutes and
 * refuses one older than an hour, so a token is reused for 40. Cached on the
 * exact key in use (a hash of key, key id and team), so a rotated key takes
 * effect on the next send and two identities never share a token.
 */
const TOKEN_TTL_MS = 40 * 60_000;
const tokenCache = new Map<string, { token: string; at: number }>();

function cacheKey(config: ApnsConfig): string {
  return createHash('sha256').update(`${config.teamId}\0${config.keyId}\0${config.key}`).digest('hex');
}

/**
 * The ES256 provider token (a JWT) for this identity.
 * @param config - The APNs identity.
 * @param now - The clock, in ms.
 */
export function apnsProviderToken(config: ApnsConfig, now: number = Date.now()): string {
  const ck = cacheKey(config);
  const cached = tokenCache.get(ck);
  if (cached && now - cached.at < TOKEN_TTL_MS) {
    return cached.token;
  }
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'ES256', kid: config.keyId })));
  const claims = b64url(Buffer.from(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) })));
  const signingInput = `${header}.${claims}`;
  // JWS wants the raw r‖s signature, not DER.
  const signature = sign('sha256', Buffer.from(signingInput), { key: createPrivateKey(config.key), dsaEncoding: 'ieee-p1363' });
  const token = `${signingInput}.${b64url(signature)}`;
  tokenCache.set(ck, { token, at: now });
  return token;
}

/**
 * Drop a cached token Apple refused, so the next attempt signs a fresh one.
 * @param config
 */
function forgetToken(config: ApnsConfig): void {
  tokenCache.delete(cacheKey(config));
}

export type ApnsRequest = { host: string; path: string; headers: Record<string, string>; body: string };
export type ApnsResponse = { status: number; body: string };
export type ApnsTransport = (req: ApnsRequest) => Promise<ApnsResponse>;

/**
 * One HTTP/2 request to APNs. A session per send: the volume here is a
 * handful a day, and a pooled session is one more thing to heal.
 * @param req - The request.
 */
export const http2Transport: ApnsTransport = req => new Promise((resolve, reject) => {
  const session = http2.connect(`https://${req.host}`);
  session.on('error', reject);
  const stream = session.request({ ':method': 'POST', ':path': req.path, ...req.headers });
  stream.setEncoding('utf8');
  let status = 0;
  let body = '';
  stream.on('response', (headers) => {
    status = Number(headers[':status'] ?? 0);
  });
  stream.on('data', (chunk: string) => {
    body += chunk;
  });
  stream.on('end', () => {
    session.close();
    resolve({ status, body });
  });
  stream.on('error', (err) => {
    session.close();
    reject(err);
  });
  stream.setTimeout(15_000, () => {
    stream.close();
    session.close();
    reject(new Error('APNs did not answer within 15s'));
  });
  stream.end(req.body);
});

export type ApnsDevice = { token: string; environment: string | null; bundleId: string | null };

/** Reasons APNs gives for a token that will never work again. */
const GONE_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken']);

/**
 * Send one notification to one iOS device.
 * @param device - The registered device.
 * @param message - What to show.
 * @param config - The deployment's APNs identity, or null.
 * @param transport - The HTTP/2 call, injectable for tests.
 */
export async function sendApns(device: ApnsDevice, message: NotificationMessage, config: ApnsConfig | null, transport: ApnsTransport = http2Transport): Promise<ChannelOutcome> {
  if (!config) {
    return { status: 'not_configured', error: `iPhone push is not configured on this server (${APNS_ENV_NAMES.join(', ')})` };
  }
  if (device.bundleId && device.bundleId !== config.bundleId) {
    return { status: 'failed', error: `this device registered for ${device.bundleId}; this server pushes to ${config.bundleId}` };
  }
  // TestFlight and App Store installs talk to production; only a build run
  // from Xcode uses the sandbox (PUSH-SETUP.md).
  const host = device.environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const payload = {
    aps: { 'alert': { title: message.title, ...(message.body ? { body: message.body } : {}) }, 'sound': 'default', 'thread-id': message.kind },
    // The app opens this on tap.
    url: message.url,
    notificationId: message.id,
  };
  let res: ApnsResponse;
  try {
    res = await transport({
      host,
      path: `/3/device/${encodeURIComponent(device.token)}`,
      headers: {
        'authorization': `bearer ${apnsProviderToken(config)}`,
        'apns-topic': config.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { status: 'retry', error: `could not reach APNs: ${(err as Error).message}` };
  }
  if (res.status === 200) {
    return { status: 'sent' };
  }
  const reason = (() => {
    try {
      return String((JSON.parse(res.body) as { reason?: string }).reason ?? '');
    } catch {
      return '';
    }
  })();
  if (res.status === 410 || GONE_REASONS.has(reason)) {
    return { status: 'gone', error: `APNs says the device token is no longer valid (${reason || res.status})` };
  }
  if (res.status === 403 && (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken')) {
    forgetToken(config);
    return { status: reason === 'ExpiredProviderToken' ? 'retry' : 'failed', error: `APNs refused the provider token (${reason}) — check the key id and team id` };
  }
  if (res.status === 429 || res.status >= 500) {
    return { status: 'retry', error: `APNs answered ${res.status}${reason ? ` (${reason})` : ''}` };
  }
  return { status: 'failed', error: `APNs refused the notification (${res.status}${reason ? ` ${reason}` : ''})` };
}
