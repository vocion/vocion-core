/**
 * Twilio, as one account a workspace holds: its Account SID and auth token
 * (`twilio` platform, `libs/platforms/registry.ts`). Text messages, WhatsApp,
 * call logs and placing a call all spend the same pair, so this is the one
 * place that finds it and the one place that talks to Twilio's REST API.
 *
 * WHICH ACCOUNT A CALL SPENDS. The workspace's stored pair first, the server's
 * `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` second — the rule every outbound
 * vendor call follows. A webhook names no workspace, only the number it was
 * sent to, so the number's binding (`chat_channel_binding`) says whose pair
 * answers it (`twilioCredentialsForChannel`).
 *
 * Errors are data: a person-readable sentence, never the token.
 */

import { Buffer } from 'node:buffer';
import process from 'node:process';

export type TwilioCredentials = { accountSid: string; authToken: string };

export type TwilioResult<T> = { ok: true; data: T } | { ok: false; status: number | null; message: string };

export const TWILIO_API = 'https://api.twilio.com/2010-04-01';

/**
 * The pair in a credential document, or null when it does not hold one.
 * @param values - A decrypted `twilio` credential, or a source's credential bag.
 */
export function twilioCredentialsFrom(values: Record<string, unknown> | null | undefined): TwilioCredentials | null {
  const accountSid = typeof values?.accountSid === 'string' ? values.accountSid.trim() : '';
  const authToken = typeof values?.authToken === 'string' ? values.authToken.trim() : '';
  return accountSid && authToken ? { accountSid, authToken } : null;
}

/** The server's own Twilio account, or null when it has none. */
export function envTwilioCredentials(): TwilioCredentials | null {
  return twilioCredentialsFrom({ accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN });
}

/**
 * The Twilio account a workspace's calls spend: its own stored pair, else the server's.
 * @param orgId - The workspace.
 */
export async function twilioCredentialsFor(orgId: string): Promise<TwilioCredentials | null> {
  const { resolvePlatformCredential } = await import('@/services/ApiTokenService');
  const stored = twilioCredentialsFrom(await resolvePlatformCredential(orgId, 'twilio').catch(() => null));
  return stored ?? envTwilioCredentials();
}

/**
 * The Twilio account behind a bound number: the bound workspace's pair, else the server's.
 * @param surface - `sms` or `whatsapp`.
 * @param channelId - The workspace's number, E.164.
 */
export async function twilioCredentialsForChannel(surface: string, channelId: string): Promise<TwilioCredentials | null> {
  const { resolveBinding } = await import('@/services/ChatSurfaceService');
  const binding = await resolveBinding(surface, null, channelId).catch(() => null);
  return binding ? twilioCredentialsFor(binding.orgId) : envTwilioCredentials();
}

/**
 * One call to Twilio's REST API, its refusal as a sentence.
 * @param creds - The account.
 * @param path - Under `/Accounts/<sid>`, e.g. `/Calls.json?PageSize=50`; or a full `https://` URL (a next page).
 * @param init - Method and form body.
 * @param init.method - Default GET.
 * @param init.form - A form body, for a POST.
 * @param fetchImpl - Injectable for tests.
 */
export async function twilioRequest<T>(creds: TwilioCredentials, path: string, init: { method?: 'GET' | 'POST' | 'DELETE'; form?: Record<string, string> } = {}, fetchImpl: typeof fetch = fetch): Promise<TwilioResult<T>> {
  const url = path.startsWith('https://') ? path : path.startsWith('/2010-04-01/') ? `https://api.twilio.com${path}` : `${TWILIO_API}/Accounts/${creds.accountSid}${path}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')}`,
        ...(init.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(init.form ? { body: new URLSearchParams(init.form).toString() } : {}),
    });
  } catch (error) {
    return { ok: false, status: null, message: `Twilio could not be reached (${error instanceof Error ? error.message : String(error)}).` };
  }
  const body = await res.json().catch(() => ({})) as T & { message?: string; code?: number };
  if (res.ok) {
    return { ok: true, data: body };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, message: 'Twilio refused the Account SID and auth token. Check both are from the same account (Console → Account info) and paste them again.' };
  }
  if (res.status === 429) {
    return { ok: false, status: res.status, message: 'Twilio is rate limiting this account; try again in a minute.' };
  }
  return { ok: false, status: res.status, message: `Twilio answered ${res.status}${body.message ? `: ${body.message}` : ''}.` };
}

/**
 * The result's value, or a thrown Error carrying its sentence. For a sync, whose contract is throw-on-failure.
 * @param result - The result.
 */
export function orThrow<T>(result: TwilioResult<T>): T {
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.data;
}

/**
 * Send a text or a WhatsApp message (`whatsapp:` addresses).
 * @param creds - The account.
 * @param msg - From, to, body.
 * @param msg.from - The workspace's number (or `whatsapp:+…`).
 * @param msg.to - The person's number (or `whatsapp:+…`).
 * @param msg.body - The words.
 * @param fetchImpl - Injectable for tests.
 */
export async function sendTwilioMessage(creds: TwilioCredentials, msg: { from: string; to: string; body: string }, fetchImpl: typeof fetch = fetch): Promise<{ sid: string } | null> {
  const out = await twilioRequest<{ sid?: string }>(creds, '/Messages.json', { method: 'POST', form: { From: msg.from, To: msg.to, Body: msg.body } }, fetchImpl);
  if (!out.ok) {
    throw new Error(`Twilio did not take the message: ${out.message}`);
  }
  return out.data.sid ? { sid: out.data.sid } : null;
}

/** One call, as Twilio's Calls resource describes it. */
export type TwilioCall = {
  sid: string;
  from: string | null;
  to: string | null;
  direction: string | null;
  status: string | null;
  startTime: string | null;
  endTime: string | null;
  durationSeconds: number | null;
  answeredBy: string | null;
  callerName: string | null;
};

type RawCall = { sid?: string; from?: string; to?: string; from_formatted?: string; to_formatted?: string; direction?: string; status?: string; start_time?: string; end_time?: string; duration?: string; answered_by?: string | null; caller_name?: string | null };

function toCall(c: RawCall): TwilioCall {
  const duration = Number.parseInt(c.duration ?? '', 10);
  return {
    sid: c.sid ?? '',
    from: c.from ?? null,
    to: c.to ?? null,
    direction: c.direction ?? null,
    status: c.status ?? null,
    startTime: c.start_time ? new Date(c.start_time).toISOString() : null,
    endTime: c.end_time ? new Date(c.end_time).toISOString() : null,
    durationSeconds: Number.isFinite(duration) ? duration : null,
    answeredBy: c.answered_by ?? null,
    callerName: c.caller_name ?? null,
  };
}

/**
 * Calls, newest first, one page at a time.
 * @param creds - The account.
 * @param opts - Filters.
 * @param opts.since - Calls started on or after this day.
 * @param opts.number - Calls to or from this number.
 * @param opts.pageSize - Default 50, at most 1000.
 * @param opts.pageUrl - A `next_page_uri` from the previous page.
 * @param fetchImpl - Injectable for tests.
 */
export async function listTwilioCalls(creds: TwilioCredentials, opts: { since?: Date | null; number?: string | null; pageSize?: number; pageUrl?: string | null } = {}, fetchImpl: typeof fetch = fetch): Promise<TwilioResult<{ calls: TwilioCall[]; nextPage: string | null }>> {
  let path = opts.pageUrl ?? null;
  if (!path) {
    const q = new URLSearchParams({ PageSize: String(Math.min(opts.pageSize ?? 50, 1000)) });
    if (opts.since) {
      // Twilio filters by day: `StartTime>=YYYY-MM-DD`.
      q.set('StartTime>', opts.since.toISOString().slice(0, 10));
    }
    path = `/Calls.json?${q.toString().replace('StartTime%3E=', 'StartTime>=')}`;
  }
  const out = await twilioRequest<{ calls?: RawCall[]; next_page_uri?: string | null }>(creds, path, {}, fetchImpl);
  if (!out.ok) {
    return out;
  }
  let calls = (out.data.calls ?? []).filter(c => c.sid).map(toCall);
  if (opts.number) {
    calls = calls.filter(c => c.from === opts.number || c.to === opts.number);
  }
  return { ok: true, data: { calls, nextPage: out.data.next_page_uri ?? null } };
}

/**
 * One call.
 * @param creds - The account.
 * @param sid - `CA…`.
 * @param fetchImpl - Injectable for tests.
 */
export async function getTwilioCall(creds: TwilioCredentials, sid: string, fetchImpl: typeof fetch = fetch): Promise<TwilioResult<TwilioCall>> {
  if (!/^CA[0-9a-f]{32}$/i.test(sid)) {
    return { ok: false, status: null, message: `${sid} is not a Twilio call SID (CA followed by 32 hex characters).` };
  }
  const out = await twilioRequest<RawCall>(creds, `/Calls/${sid}.json`, {}, fetchImpl);
  return out.ok ? { ok: true, data: toCall(out.data) } : out;
}

/** A call's recording and, when Twilio transcribed it, the words. */
export type TwilioRecording = { sid: string; durationSeconds: number | null; url: string; transcript: string | null };

/**
 * A call's recordings, each with its transcription text when there is one.
 * @param creds - The account.
 * @param callSid - The call.
 * @param fetchImpl - Injectable for tests.
 */
export async function twilioRecordingsFor(creds: TwilioCredentials, callSid: string, fetchImpl: typeof fetch = fetch): Promise<TwilioResult<TwilioRecording[]>> {
  const recs = await twilioRequest<{ recordings?: { sid?: string; duration?: string }[] }>(creds, `/Calls/${callSid}/Recordings.json`, {}, fetchImpl);
  if (!recs.ok) {
    return recs;
  }
  const out: TwilioRecording[] = [];
  for (const r of recs.data.recordings ?? []) {
    if (!r.sid) {
      continue;
    }
    const tx = await twilioRequest<{ transcriptions?: { transcription_text?: string | null; status?: string }[] }>(creds, `/Recordings/${r.sid}/Transcriptions.json`, {}, fetchImpl);
    const text = tx.ok ? (tx.data.transcriptions ?? []).filter(t => t.status !== 'failed').map(t => t.transcription_text ?? '').filter(Boolean).join('\n') : '';
    const duration = Number.parseInt(r.duration ?? '', 10);
    out.push({ sid: r.sid, durationSeconds: Number.isFinite(duration) ? duration : null, url: `${TWILIO_API}/Accounts/${creds.accountSid}/Recordings/${r.sid}`, transcript: text || null });
  }
  return { ok: true, data: out };
}

/**
 * The account's name and status: the cheap read Test connection makes.
 * @param creds - The account.
 * @param fetchImpl - Injectable for tests.
 */
export async function readTwilioAccount(creds: TwilioCredentials, fetchImpl: typeof fetch = fetch): Promise<TwilioResult<{ name: string | null; status: string | null; type: string | null }>> {
  const out = await twilioRequest<{ friendly_name?: string; status?: string; type?: string }>(creds, `/2010-04-01/Accounts/${creds.accountSid}.json`, {}, fetchImpl);
  return out.ok ? { ok: true, data: { name: out.data.friendly_name ?? null, status: out.data.status ?? null, type: out.data.type ?? null } } : out;
}

/**
 * The account's phone numbers, for Test connection to name what can text or call.
 * @param creds - The account.
 * @param fetchImpl - Injectable for tests.
 */
export async function listTwilioNumbers(creds: TwilioCredentials, fetchImpl: typeof fetch = fetch): Promise<TwilioResult<string[]>> {
  const out = await twilioRequest<{ incoming_phone_numbers?: { phone_number?: string }[] }>(creds, '/IncomingPhoneNumbers.json?PageSize=20', {}, fetchImpl);
  return out.ok ? { ok: true, data: (out.data.incoming_phone_numbers ?? []).map(n => n.phone_number ?? '').filter(Boolean) } : out;
}

/**
 * Escape text for TwiML.
 * @param text - The text.
 */
function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Place a call that says a message and hangs up.
 * @param creds - The account.
 * @param call - From, to, what to say.
 * @param call.from - A number on the account, E.164.
 * @param call.to - Who to call, E.164.
 * @param call.say - What the call says.
 * @param fetchImpl - Injectable for tests.
 */
export async function placeTwilioCall(creds: TwilioCredentials, call: { from: string; to: string; say: string }, fetchImpl: typeof fetch = fetch): Promise<TwilioResult<{ sid: string; status: string | null }>> {
  const out = await twilioRequest<{ sid?: string; status?: string }>(creds, '/Calls.json', { method: 'POST', form: { From: call.from, To: call.to, Twiml: `<Response><Say>${xml(call.say)}</Say></Response>` } }, fetchImpl);
  if (!out.ok) {
    return out;
  }
  return out.data.sid ? { ok: true, data: { sid: out.data.sid, status: out.data.status ?? null } } : { ok: false, status: null, message: 'Twilio took the call but returned no call SID.' };
}
