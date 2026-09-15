import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bareAddress, htmlToText, normaliseSubject, parseResendPayload, referencedMessageIds, replySubject, stripAngles, stripQuotedHistory, verifySvixSignature } from './email';

const SECRET = `whsec_${Buffer.from('a-32-byte-test-secret-for-svix!!').toString('base64')}`;
const BODY = '{"type":"email.received","data":{"email_id":"e1"}}';
const NOW = 1_700_000_000;

function sign(id: string, ts: number, body: string, secret = SECRET): string {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  return createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
}

function headers(h: Record<string, string>): Headers {
  return new Headers(h);
}

describe('verifySvixSignature', () => {
  it('accepts a correctly signed body, including when the header lists several signatures', () => {
    const sig = sign('msg_1', NOW, BODY);

    expect(verifySvixSignature(BODY, headers({ 'svix-id': 'msg_1', 'svix-timestamp': String(NOW), 'svix-signature': `v1,${sig}` }), SECRET, NOW)).toEqual({ ok: true });
    expect(verifySvixSignature(BODY, headers({ 'svix-id': 'msg_1', 'svix-timestamp': String(NOW), 'svix-signature': `v1,AAAA v1,${sig}` }), SECRET, NOW)).toEqual({ ok: true });
  });

  it('rejects a wrong secret, a tampered body, a replay outside five minutes, and missing pieces', () => {
    const sig = sign('msg_1', NOW, BODY);
    const good = { 'svix-id': 'msg_1', 'svix-timestamp': String(NOW), 'svix-signature': `v1,${sig}` };

    expect(verifySvixSignature(BODY, headers(good), `whsec_${Buffer.from('another-secret-entirely-1234567').toString('base64')}`, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifySvixSignature(`${BODY} `, headers(good), SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifySvixSignature(BODY, headers(good), SECRET, NOW + 301)).toEqual({ ok: false, reason: 'stale' });
    expect(verifySvixSignature(BODY, headers({ 'svix-id': 'msg_1' }), SECRET, NOW)).toEqual({ ok: false, reason: 'missing_headers' });
    expect(verifySvixSignature(BODY, headers(good), undefined, NOW)).toEqual({ ok: false, reason: 'missing_secret' });
  });
});

describe('parseResendPayload', () => {
  it('normalises an email.received event and ignores everything else', () => {
    const parsed = parseResendPayload({
      type: 'email.received',
      data: {
        email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
        from: 'Chris Fitkin <Chris@Example.com>',
        to: ['Revenue@agents.example.com'],
        cc: ['ops@example.com'],
        message_id: '<111-222-333@email.example.com>',
        subject: '  Q4 pipeline  ',
        attachments: [{ id: 'a1', filename: 'deck.pdf', content_type: 'application/pdf' }, { filename: 'no-id.png' }],
      },
    });

    expect(parsed.kind).toBe('message');

    if (parsed.kind === 'message') {
      expect(parsed.inbound).toEqual({
        surface: 'email',
        receivedEmailId: '56761188-7520-42d8-8898-ff6fc54ce618',
        from: 'chris@example.com',
        fromRaw: 'Chris Fitkin <Chris@Example.com>',
        recipients: ['revenue@agents.example.com', 'ops@example.com'],
        subject: 'Q4 pipeline',
        messageId: '111-222-333@email.example.com',
        attachments: [{ id: 'a1', filename: 'deck.pdf', contentType: 'application/pdf' }],
      });
    }

    expect(parseResendPayload({ type: 'email.delivered', data: { email_id: 'x' } })).toEqual({ kind: 'ignore', reason: 'event type email.delivered' });
    expect(parseResendPayload({ type: 'email.received', data: { from: 'a@b.c' } })).toEqual({ kind: 'ignore', reason: 'incomplete event' });
    expect(parseResendPayload(null)).toEqual({ kind: 'ignore', reason: 'event type unknown' });
  });
});

describe('text helpers', () => {
  it('extracts bare addresses and strips Message-ID brackets', () => {
    expect(bareAddress('Chris <CHRIS@Example.com>')).toBe('chris@example.com');
    expect(bareAddress('plain@example.com')).toBe('plain@example.com');
    expect(stripAngles('<abc@host>')).toBe('abc@host');
    expect(stripAngles('')).toBeNull();
  });

  it('cuts quoted history and signatures but never returns empty for a non-empty mail', () => {
    const mail = 'Can you push the close date?\n\nThanks\n-- \nChris\n\nOn Mon, Sep 15, 2026 at 5:04 AM Vocion <revenue@x> wrote:\n> Revenue Briefing\n> …';

    expect(stripQuotedHistory(mail)).toBe('Can you push the close date?\n\nThanks');
    expect(stripQuotedHistory('> only quoted\n> lines')).toBe('> only quoted\n> lines');
  });

  it('turns HTML into readable text and normalises subjects', () => {
    expect(htmlToText('<p>Hello <b>there</b></p><div>Second &amp; last</div>')).toBe('Hello there\nSecond & last');
    expect(normaliseSubject('Re: RE: Fwd: Q4 pipeline')).toBe('q4 pipeline');
    expect(replySubject('Re: Re: Q4 pipeline')).toBe('Re: Q4 pipeline');
    expect(replySubject('')).toBe('Re: your message');
  });

  it('lists referenced Message-IDs, In-Reply-To first, without duplicates', () => {
    expect(referencedMessageIds({ 'In-Reply-To': '<b@x>', 'references': '<a@x> <b@x> <c@x>' })).toEqual(['b@x', 'a@x', 'c@x']);
    expect(referencedMessageIds(undefined)).toEqual([]);
  });
});
