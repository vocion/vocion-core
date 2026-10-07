import { describe, expect, it } from 'vitest';
import { toE164 } from '@/libs/phone';
import { parseSms, smsText, twilioSignature, verifyTwilio } from './sms';

/** Text messages as a chat surface, through Twilio. Numbers are fictional (555). */

const URL = 'https://vocion.example/api/webhooks/twilio/sms';
const TOKEN = 'test-auth-token';
const form = { AccountSid: 'ACtest', MessageSid: 'SM1', From: '+19705550100', To: '+19705550199', Body: 'approve the plan' };
const raw = new URLSearchParams(form).toString();

describe('the SMS surface', () => {
  it('takes a webhook Twilio signed, and refuses one it did not', () => {
    const sig = twilioSignature(URL, form, TOKEN);

    expect(verifyTwilio(raw, new Headers({ 'x-twilio-signature': sig }), TOKEN, URL)).toEqual({ ok: true });
    expect(verifyTwilio(raw, new Headers({ 'x-twilio-signature': sig }), TOKEN, `${URL}?x=1`)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyTwilio(raw, new Headers(), TOKEN, URL)).toEqual({ ok: false, reason: 'missing_headers' });
    expect(verifyTwilio(raw, new Headers({ 'x-twilio-signature': sig }), undefined, URL)).toEqual({ ok: false, reason: 'missing_secret' });
  });

  it('reads a text as a message from the person, on the workspace\'s number, one thread per person', () => {
    expect(parseSms(form)).toEqual({ kind: 'message', inbound: { surface: 'sms', teamId: null, channelId: '+19705550199', threadRef: '+19705550100', messageRef: 'SM1', externalUserId: '+19705550100', text: 'approve the plan', isDirect: true } });
    expect(parseSms({ ...form, Body: '  ' }).kind).toBe('ignore');
    expect(parseSms({ ...form, From: 'not a number' }).kind).toBe('ignore');
  });

  it('writes a text: no markdown, whole links, pictures as links, one text long', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://vocion.example';

    expect(smsText('**Done** ✅ [FE-9](/w/sq/dashboard/p/feature/9)\n- one\n- two')).toBe('Done ✅ FE-9 (https://vocion.example/w/sq/dashboard/p/feature/9)\n• one\n• two');
    expect(smsText('x'.repeat(2000))).toHaveLength(1500);
  });

  it('reads a phone number the ways people type one', () => {
    expect(toE164('(970) 555-0100')).toBe('+19705550100');
    expect(toE164('1 970 555 0100')).toBe('+19705550100');
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
    expect(toE164('555-0100')).toBeNull();
    expect(toE164('')).toBeNull();
  });
});
