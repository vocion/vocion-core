import { describe, expect, it } from 'vitest';
import { twilioSignature, verifyTwilio } from './sms';
import { fromWhatsAppAddress, parseWhatsApp, whatsappText } from './whatsapp';

/** WhatsApp as a chat surface, through a Twilio WhatsApp sender. Numbers are fictional (555). */

const URL = 'https://vocion.example/api/webhooks/twilio/whatsapp';
const TOKEN = 'test-auth-token';
const form = { AccountSid: 'ACtest', MessageSid: 'SM2', From: 'whatsapp:+19705550100', To: 'whatsapp:+19705550199', Body: 'what is due today', NumMedia: '0' };

describe('the WhatsApp surface', () => {
  it('takes a webhook Twilio signed with the account token, as a text is', () => {
    const raw = new URLSearchParams(form).toString();
    const sig = twilioSignature(URL, form, TOKEN);

    expect(verifyTwilio(raw, new Headers({ 'x-twilio-signature': sig }), TOKEN, URL)).toEqual({ ok: true });
    expect(verifyTwilio(raw, new Headers({ 'x-twilio-signature': sig }), 'another-token', URL)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('reads a message as one from the person, on the workspace number, the whatsapp: prefix taken off', () => {
    expect(parseWhatsApp(form)).toEqual({ kind: 'message', inbound: { surface: 'whatsapp', teamId: null, channelId: '+19705550199', threadRef: '+19705550100', messageRef: 'SM2', externalUserId: '+19705550100', text: 'what is due today', isDirect: true } });
    expect(parseWhatsApp({ ...form, From: '+19705550100' }).kind).toBe('ignore');
    expect(parseWhatsApp({ ...form, Body: '', NumMedia: '1' })).toEqual({ kind: 'ignore', reason: expect.stringMatching(/picture/) });
    expect(fromWhatsAppAddress('WhatsApp:+44 20 7946 0958')).toBe('+442079460958');
  });

  it('writes markdown the way WhatsApp renders it, links whole, one message long', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://vocion.example';

    expect(whatsappText('## Plan\n**Done** [FE-9](/w/sq/dashboard/p/feature/9)\n- one')).toBe('*Plan*\n*Done* FE-9 (https://vocion.example/w/sq/dashboard/p/feature/9)\n• one');
    expect(whatsappText('x'.repeat(5000))).toHaveLength(1600);
  });
});
