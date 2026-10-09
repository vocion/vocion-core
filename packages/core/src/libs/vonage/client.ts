/**
 * Vonage, as one account a workspace holds: its API key and secret, plus the signature secret
 * its webhooks are signed with (`vonage` platform, `libs/platforms/registry.ts`). Texts through
 * the SMS API and the account's voice call records through the Reports API both spend the same
 * key and secret, so this is the one place that finds them and talks to Vonage.
 *
 * WHICH ACCOUNT A CALL SPENDS. The workspace's stored credential first, the server's
 * `VONAGE_API_KEY` / `VONAGE_API_SECRET` / `VONAGE_SIGNATURE_SECRET` second. A webhook names no
 * workspace, only the number it was sent to, so the number's binding says whose secret checks it.
 *
 * SIGNED WEBHOOKS. With signing on (Dashboard → Settings → API settings → Signed webhooks),
 * Vonage adds `sig` and `timestamp`: every other parameter sorted by name, written
 * `&name=value` with `&` and `=` in values turned into `_`, then hashed — an MD5 of that string
 * with the secret appended (`md5hash`), or an HMAC keyed with the secret (`md5`, `sha1`,
 * `sha256`, `sha512`). The method is the dashboard's choice, so it is stored with the secret.
 */

import { Buffer } from 'node:buffer';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import process from 'node:process';

export type VonageSignatureMethod = 'md5hash' | 'md5' | 'sha1' | 'sha256' | 'sha512';

export type VonageCredentials = {
  apiKey: string;
  apiSecret: string;
  signatureSecret: string | null;
  signatureMethod: VonageSignatureMethod;
};

export type VonageResult<T> = { ok: true; data: T } | { ok: false; status: number | null; message: string };

const METHODS: readonly VonageSignatureMethod[] = ['md5hash', 'md5', 'sha1', 'sha256', 'sha512'];

/**
 * The credential in a document, or null when it does not hold a key and secret.
 * @param values - A decrypted `vonage` credential, or a source's credential bag.
 */
export function vonageCredentialsFrom(values: Record<string, unknown> | null | undefined): VonageCredentials | null {
  const str = (k: string) => (typeof values?.[k] === 'string' ? (values[k] as string).trim() : '');
  const apiKey = str('apiKey');
  const apiSecret = str('apiSecret');
  if (!apiKey || !apiSecret) {
    return null;
  }
  const method = str('signatureMethod').toLowerCase() as VonageSignatureMethod;
  return { apiKey, apiSecret, signatureSecret: str('signatureSecret') || null, signatureMethod: METHODS.includes(method) ? method : 'sha256' };
}

/** The server's own Vonage account, or null when it has none. */
export function envVonageCredentials(): VonageCredentials | null {
  return vonageCredentialsFrom({ apiKey: process.env.VONAGE_API_KEY, apiSecret: process.env.VONAGE_API_SECRET, signatureSecret: process.env.VONAGE_SIGNATURE_SECRET, signatureMethod: process.env.VONAGE_SIGNATURE_METHOD });
}

/**
 * The Vonage account a workspace's calls spend: its own stored credential, else the server's.
 * @param orgId - The workspace.
 */
export async function vonageCredentialsFor(orgId: string): Promise<VonageCredentials | null> {
  const { resolvePlatformCredential } = await import('@/services/ApiTokenService');
  return vonageCredentialsFrom(await resolvePlatformCredential(orgId, 'vonage').catch(() => null)) ?? envVonageCredentials();
}

/**
 * The Vonage account behind a bound number: the bound workspace's, else the server's.
 * @param channelId - The workspace's number, E.164.
 */
export async function vonageCredentialsForChannel(channelId: string): Promise<VonageCredentials | null> {
  const { resolveBinding } = await import('@/services/ChatSurfaceService');
  const binding = await resolveBinding('vonage', null, channelId).catch(() => null);
  return binding ? vonageCredentialsFor(binding.orgId) : envVonageCredentials();
}

/**
 * Vonage writes numbers as digits with no `+`; Vocion writes E.164.
 * @param raw - `14155550100`, or already `+14155550100`.
 */
export function vonageNumberToE164(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

/**
 * Vonage's signature over a webhook's parameters (everything but `sig`).
 * @param params - The parameters as received.
 * @param secret - The account's signature secret.
 * @param method - The dashboard's signature method.
 */
export function vonageSignature(params: Record<string, string>, secret: string, method: VonageSignatureMethod): string {
  const query = Object.keys(params)
    .filter(k => k !== 'sig')
    .sort()
    .map(k => `&${k}=${String(params[k]).replace(/[&=]/g, '_')}`)
    .join('');
  if (method === 'md5hash') {
    return createHash('md5').update(query + secret).digest('hex');
  }
  return createHmac(method, secret).update(query).digest('hex');
}

/** How stale a signed webhook may be before it is refused as a replay. */
const MAX_SKEW_SECONDS = 5 * 60;

/**
 * Check a webhook came from Vonage.
 * @param params - The parameters as received.
 * @param creds - The account whose secret signs it.
 * @param now - The clock.
 */
export function verifyVonage(params: Record<string, string>, creds: Pick<VonageCredentials, 'signatureSecret' | 'signatureMethod'> | null, now: Date = new Date()): { ok: true } | { ok: false; reason: 'missing_secret' | 'missing_headers' | 'stale' | 'bad_signature' } {
  if (!creds?.signatureSecret) {
    return { ok: false, reason: 'missing_secret' };
  }
  const given = params.sig;
  if (!given) {
    return { ok: false, reason: 'missing_headers' };
  }
  const ts = Number(params.timestamp);
  if (Number.isFinite(ts) && Math.abs(now.getTime() / 1000 - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'stale' };
  }
  const want = vonageSignature(params, creds.signatureSecret, creds.signatureMethod);
  const a = Buffer.from(given.toLowerCase());
  const b = Buffer.from(want.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

/**
 * One call to Vonage, its refusal as a sentence. Never echoes the key or secret.
 * @param url - The full URL.
 * @param init - Method, basic auth, form body.
 * @param init.method - Default GET.
 * @param init.basic - Send the key and secret as basic auth (the Reports API).
 * @param init.form - A form body.
 * @param fetchImpl - Injectable for tests.
 */
async function vonageRequest<T>(url: string, init: { method?: 'GET' | 'POST'; basic?: VonageCredentials; form?: Record<string, string> }, fetchImpl: typeof fetch): Promise<VonageResult<T>> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.basic ? { authorization: `Basic ${Buffer.from(`${init.basic.apiKey}:${init.basic.apiSecret}`).toString('base64')}` } : {}),
        ...(init.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(init.form ? { body: new URLSearchParams(init.form).toString() } : {}),
    });
  } catch (error) {
    return { ok: false, status: null, message: `Vonage could not be reached (${error instanceof Error ? error.message : String(error)}).` };
  }
  const body = await res.json().catch(() => ({})) as T & { 'title'?: string; 'detail'?: string; 'error-code-label'?: string };
  if (res.ok) {
    return { ok: true, data: body };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, message: 'Vonage refused the API key and secret. Copy both from the Vonage dashboard (API settings) and paste them again.' };
  }
  if (res.status === 429) {
    return { ok: false, status: res.status, message: 'Vonage is rate limiting this account; try again in a minute.' };
  }
  const detail = body.detail ?? body.title ?? body['error-code-label'];
  return { ok: false, status: res.status, message: `Vonage answered ${res.status}${detail ? `: ${detail}` : ''}.` };
}

/**
 * The account's balance: the cheap read Test connection makes.
 * @param creds - The account.
 * @param fetchImpl - Injectable for tests.
 */
export async function readVonageBalance(creds: VonageCredentials, fetchImpl: typeof fetch = fetch): Promise<VonageResult<{ value: number | null; autoReload: boolean | null }>> {
  const q = new URLSearchParams({ api_key: creds.apiKey, api_secret: creds.apiSecret });
  const out = await vonageRequest<{ value?: number; autoReload?: boolean }>(`https://rest.nexmo.com/account/get-balance?${q.toString()}`, {}, fetchImpl);
  return out.ok ? { ok: true, data: { value: typeof out.data.value === 'number' ? out.data.value : null, autoReload: out.data.autoReload ?? null } } : out;
}

/**
 * Send a text from the workspace's number.
 * @param creds - The account.
 * @param msg - From, to, words (E.164).
 * @param msg.from - The workspace's number.
 * @param msg.to - The person's number.
 * @param msg.text - The words.
 * @param fetchImpl - Injectable for tests.
 */
export async function sendVonageSms(creds: VonageCredentials, msg: { from: string; to: string; text: string }, fetchImpl: typeof fetch = fetch): Promise<{ id: string } | null> {
  const out = await vonageRequest<{ messages?: { 'status'?: string; 'message-id'?: string; 'error-text'?: string }[] }>('https://rest.nexmo.com/sms/json', {
    method: 'POST',
    form: { api_key: creds.apiKey, api_secret: creds.apiSecret, from: msg.from.replace(/^\+/, ''), to: msg.to.replace(/^\+/, ''), text: msg.text, type: 'unicode' },
  }, fetchImpl);
  if (!out.ok) {
    throw new Error(`Vonage did not take the text: ${out.message}`);
  }
  const first = out.data.messages?.[0];
  if (first && first.status && first.status !== '0') {
    throw new Error(`Vonage did not take the text: ${first['error-text'] ?? `status ${first.status}`}`);
  }
  return first?.['message-id'] ? { id: first['message-id'] } : null;
}

/** One voice call, as the Reports API records it. */
export type VonageCall = {
  id: string;
  from: string | null;
  to: string | null;
  direction: 'inbound' | 'outbound';
  status: string | null;
  startTime: string | null;
  endTime: string | null;
  durationSeconds: number | null;
  price: string | null;
};

type RawRecord = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null;
}

function toCall(r: RawRecord, direction: 'inbound' | 'outbound'): VonageCall | null {
  const id = str(r.uuid) ?? str(r.call_id) ?? str(r.id);
  if (!id) {
    return null;
  }
  const duration = Number.parseInt(str(r.duration) ?? '', 10);
  const iso = (v: unknown) => {
    const s = str(v);
    const t = s ? Date.parse(s) : Number.NaN;
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  };
  return {
    id,
    from: vonageNumberToE164(str(r.from)) ?? str(r.from),
    to: vonageNumberToE164(str(r.to)) ?? str(r.to),
    direction,
    status: str(r.status),
    startTime: iso(r.start_time ?? r.date_start),
    endTime: iso(r.end_time ?? r.date_end),
    durationSeconds: Number.isFinite(duration) ? duration : null,
    price: str(r.total_price ?? r.price),
  };
}

/**
 * The account's voice calls in a window, both directions, through the Reports API (key and
 * secret as basic auth — the one voice read that needs no Vonage Application).
 * @param creds - The account.
 * @param window - The window.
 * @param window.since - Start.
 * @param window.until - End (default now).
 * @param fetchImpl - Injectable for tests.
 */
export async function listVonageCalls(creds: VonageCredentials, window: { since: Date; until?: Date }, fetchImpl: typeof fetch = fetch): Promise<VonageResult<VonageCall[]>> {
  const calls: VonageCall[] = [];
  for (const direction of ['inbound', 'outbound'] as const) {
    const q = new URLSearchParams({
      account_id: creds.apiKey,
      product: 'VOICE-CALL',
      direction,
      date_start: window.since.toISOString(),
      date_end: (window.until ?? new Date()).toISOString(),
    });
    let url: string | null = `https://api.nexmo.com/v2/reports/records?${q.toString()}`;
    for (let page = 0; url && page < 50; page++) {
      const out: VonageResult<{ records?: RawRecord[]; _links?: { next?: { href?: string } } }> = await vonageRequest(url, { basic: creds }, fetchImpl);
      if (!out.ok) {
        return out;
      }
      for (const r of out.data.records ?? []) {
        const call = toCall(r, direction);
        if (call) {
          calls.push(call);
        }
      }
      const next: string | undefined = out.data._links?.next?.href;
      url = next && next !== url ? next : null;
    }
  }
  calls.sort((a, b) => (b.startTime ?? '').localeCompare(a.startTime ?? ''));
  return { ok: true, data: calls };
}
