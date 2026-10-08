import { describe, expect, it } from 'vitest';
import { verifyVonage, vonageNumberToE164, vonageSignature } from '@/libs/vonage/client';
import { parseVonage, vonageParams } from './vonage';

/** Text messages through Vonage. Numbers are fictional (555); the secret is a fixture. */

const SECRET = 'fixture-signature-secret';
const now = new Date('2026-10-08T12:00:00Z');
const base = { msisdn: '19705550100', to: '19705550199', messageId: '0A0000000123ABCD', text: 'approve it', type: 'text', timestamp: String(Math.floor(now.getTime() / 1000)) };

describe('the Vonage surface', () => {
  it('takes a webhook Vonage signed, by the method the dashboard chose, and refuses one it did not', () => {
    for (const method of ['sha256', 'md5hash', 'sha512'] as const) {
      const signed = { ...base, sig: vonageSignature(base, SECRET, method) };

      expect(verifyVonage(signed, { signatureSecret: SECRET, signatureMethod: method }, now), method).toEqual({ ok: true });
      expect(verifyVonage({ ...signed, text: 'reject it' }, { signatureSecret: SECRET, signatureMethod: method }, now), method).toEqual({ ok: false, reason: 'bad_signature' });
    }

    expect(verifyVonage({ ...base, sig: 'X'.toUpperCase() }, { signatureSecret: null, signatureMethod: 'sha256' }, now)).toEqual({ ok: false, reason: 'missing_secret' });
    expect(verifyVonage(base, { signatureSecret: SECRET, signatureMethod: 'sha256' }, now)).toEqual({ ok: false, reason: 'missing_headers' });
  });

  it('refuses a signed webhook replayed long after it was sent', () => {
    const old = { ...base, timestamp: String(Math.floor(now.getTime() / 1000) - 3600) };

    expect(verifyVonage({ ...old, sig: vonageSignature(old, SECRET, 'sha256') }, { signatureSecret: SECRET, signatureMethod: 'sha256' }, now)).toEqual({ ok: false, reason: 'stale' });
  });

  it('accepts the signature in either case, as Vonage SDKs print it both ways', () => {
    const sig = vonageSignature(base, SECRET, 'sha256').toUpperCase();

    expect(verifyVonage({ ...base, sig }, { signatureSecret: SECRET, signatureMethod: 'sha256' }, now)).toEqual({ ok: true });
  });

  it('reads the body whichever way the account sends it, and the text as the person\'s', () => {
    const query = new URLSearchParams(base).toString();

    expect(vonageParams(query)).toEqual(base);
    expect(vonageParams(JSON.stringify({ ...base, extra: { nested: true } }))).toEqual(base);
    expect(parseVonage(base)).toEqual({ kind: 'message', inbound: { surface: 'vonage', teamId: null, channelId: '+19705550199', threadRef: '+19705550100', messageRef: base.messageId, externalUserId: '+19705550100', text: 'approve it', isDirect: true } });
    expect(parseVonage({ ...base, text: ' ' }).kind).toBe('ignore');
    expect(vonageNumberToE164('447700900123')).toBe('+447700900123');
  });
});
