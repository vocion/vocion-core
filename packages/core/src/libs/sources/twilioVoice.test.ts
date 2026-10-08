import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { getPlatform, platformForConnectorSlug, validatePlatformCredential } from '@/libs/platforms/registry';
import { configFieldsFor } from '@/libs/sources/configFields';
import { getConnector } from '@/libs/sources/registry';
import { inspectTwilio, syncTwilioVoice, twilioVoiceConnector } from '@/libs/sources/twilioVoice';

/**
 * Twilio Voice against a stand-in Twilio: the call log with its pages, the recordings and their
 * transcripts, and Test connection. Fictional account, numbers on the 555 exchange.
 */

const SID = `AC${'a'.repeat(32)}`;
const TOKEN = 'f'.repeat(32);
const CALL_1 = `CA${'1'.repeat(32)}`;
const CALL_2 = `CA${'2'.repeat(32)}`;

type Route = { status?: number; json?: unknown };

function net(routes: Record<string, Route>) {
  const calls: { url: string; method: string; auth: string | null }[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push({ url: input, method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('authorization') });
    const key = Object.keys(routes).find(k => url.pathname.endsWith(k.split('?')[0]!) && (!k.includes('?') || url.search.includes(k.split('?')[1]!)));
    const r = key ? routes[key]! : { status: 404, json: { message: 'not found' } };
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const page1 = { calls: [{ sid: CALL_1, from: '+19705550100', to: '+19705550199', direction: 'inbound', status: 'completed', start_time: 'Tue, 06 Oct 2026 15:00:00 +0000', end_time: 'Tue, 06 Oct 2026 15:04:00 +0000', duration: '240' }], next_page_uri: `/2010-04-01/Accounts/${SID}/Calls.json?Page=1&PageToken=PA1` };
const page2 = { calls: [{ sid: CALL_2, from: '+19705550199', to: '+19705550101', direction: 'outbound-api', status: 'no-answer', start_time: 'Mon, 05 Oct 2026 09:00:00 +0000', duration: '0' }], next_page_uri: null };

describe('the twilio-voice connector', () => {
  it('is registered on the twilio platform, which holds an Account SID and auth token', () => {
    expect(getConnector('twilio-voice')).toBe(twilioVoiceConnector);
    expect(platformForConnectorSlug('twilio-voice')?.id).toBe('twilio');
    expect(getPlatform('twilio').credentialsPerOrg).toBe('one-live');
    expect(validatePlatformCredential('twilio', { accountSid: SID, authToken: TOKEN })).toEqual({ accountSid: SID, authToken: TOKEN });
    expect(() => validatePlatformCredential('twilio', { accountSid: 'SK123', authToken: TOKEN })).toThrow(/Account SID/);
    expect(configFieldsFor('twilio-voice').map(f => f.key)).toEqual(['pastDays', 'includeRecordings']);
  });

  it('syncs every page of calls as documents, with the words of a transcribed recording', async () => {
    const { fetchImpl, calls } = net({
      '/Calls.json?PageToken=PA1': { json: page2 },
      '/Calls.json': { json: page1 },
      [`/Calls/${CALL_1}/Recordings.json`]: { json: { recordings: [{ sid: 'RE1', duration: '230' }] } },
      [`/Calls/${CALL_2}/Recordings.json`]: { json: { recordings: [] } },
      '/Recordings/RE1/Transcriptions.json': { json: { transcriptions: [{ status: 'completed', transcription_text: 'Northwind wants the revised quote by Friday.' }] } },
    });
    const docs = [];
    for await (const doc of syncTwilioVoice({ sourceId: 1, orgId: 'org_a', config: {}, credentials: { accountSid: SID, authToken: TOKEN } }, fetchImpl)) {
      docs.push(doc);
    }

    expect(docs.map(d => d.externalId)).toEqual([`twilio:call:${CALL_1}`, `twilio:call:${CALL_2}`]);
    expect(docs[0]!.content).toContain('Northwind wants the revised quote by Friday.');
    expect(docs[0]!.metadata).toMatchObject({ from: '+19705550100', durationSeconds: 240, recordings: ['RE1'] });
    expect(docs[1]!.content).toMatch(/no-answer/);
    // Basic auth with the account's own pair, on every request.
    expect(new Set(calls.map(c => c.auth))).toEqual(new Set([`Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`]));
    // Read from the window's first day.
    expect(calls[0]!.url).toMatch(/StartTime>=\d{4}-\d{2}-\d{2}/);
  });

  it('reads from the watermark\'s day on an incremental run', async () => {
    const { fetchImpl, calls } = net({ '/Calls.json': { json: { calls: [], next_page_uri: null } } });
    for await (const _ of syncTwilioVoice({ sourceId: 1, orgId: 'org_a', config: {}, credentials: { accountSid: SID, authToken: TOKEN }, since: new Date() }, fetchImpl)) {
      // nothing
    }

    expect(calls[0]!.url).toContain(`StartTime>=${new Date().toISOString().slice(0, 10)}`);
  });

  it('fails a sync whose pair Twilio refuses, with the fix in the sentence', async () => {
    const { fetchImpl } = net({ '/Calls.json': { status: 401, json: { code: 20003, message: 'Authenticate' } } });
    const run = async () => {
      for await (const _ of syncTwilioVoice({ sourceId: 1, orgId: 'org_a', config: {}, credentials: { accountSid: SID, authToken: TOKEN } }, fetchImpl)) {
        // nothing
      }
    };

    await expect(run()).rejects.toThrow(/refused the Account SID and auth token/);
  });

  it('tests the connection read-only: the account, its numbers and its call log', async () => {
    const { fetchImpl, calls } = net({
      [`/Accounts/${SID}.json`]: { json: { friendly_name: 'Northwind Support', status: 'active', type: 'Full' } },
      '/IncomingPhoneNumbers.json': { json: { incoming_phone_numbers: [{ phone_number: '+19705550199' }] } },
      '/Calls.json': { json: page2 },
    });
    const res = await inspectTwilio({ credentials: { accountSid: SID, authToken: TOKEN } }, fetchImpl);

    expect(res).toMatchObject({ reachable: true, authorized: true, error: null });
    expect(res.checks.map(c => [c.key, c.ok])).toEqual([['account', true], ['numbers', true], ['calls', true]]);
    expect(res.checks[0]!.detail).toBe('Northwind Support · active · Full');
    expect(calls.every(c => c.method === 'GET')).toBe(true);
  });

  it('asks for the pair before calling out', async () => {
    await expect(inspectTwilio({ credentials: {} })).rejects.toThrow(/Account SID and auth token/);
  });
});

describe('which Twilio account a call spends', () => {
  it('uses each workspace\'s own stored pair, one after the other, and the server\'s when it stored none', async () => {
    vi.resetModules();
    const stored: Record<string, Record<string, string> | null> = {
      org_a: { accountSid: `AC${'a'.repeat(32)}`, authToken: 'a'.repeat(32) },
      org_b: { accountSid: `AC${'b'.repeat(32)}`, authToken: 'b'.repeat(32) },
      org_c: null,
    };
    vi.doMock('@/services/ApiTokenService', () => ({ resolvePlatformCredential: async (orgId: string, platform: string) => (platform === 'twilio' ? stored[orgId] ?? null : null) }));
    process.env.TWILIO_ACCOUNT_SID = `AC${'e'.repeat(32)}`;
    process.env.TWILIO_AUTH_TOKEN = 'e'.repeat(32);
    const { twilioCredentialsFor } = await import('@/libs/twilio/client');

    expect((await twilioCredentialsFor('org_a'))?.accountSid).toBe(`AC${'a'.repeat(32)}`);
    expect((await twilioCredentialsFor('org_b'))?.accountSid).toBe(`AC${'b'.repeat(32)}`);
    expect((await twilioCredentialsFor('org_c'))?.accountSid).toBe(`AC${'e'.repeat(32)}`);

    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    vi.doUnmock('@/services/ApiTokenService');
  });
});
