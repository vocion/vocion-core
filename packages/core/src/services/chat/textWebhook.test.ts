import { describe, expect, it, vi } from 'vitest';

/**
 * The one webhook shape every text surface (Twilio SMS, WhatsApp, Vonage) shares: verify, parse,
 * ack at once, then answer a member or tell a stranger how to become one. Numbers on 555.
 */

const replies: { target: unknown; text: unknown }[] = [];
const answered: unknown[] = [];

vi.mock('@/services/ChatSurfaceService', () => ({
  resolveBinding: async (_surface: string, _team: string | null, channelId: string) => (channelId === '+19705550199' ? { orgId: 'org_a', agentSlug: 'front-desk' } : null),
  handleInbound: async (_adapter: unknown, inbound: unknown) => {
    answered.push(inbound);
    return { outcome: 'replied', orgId: 'org_a', agentSlug: 'front-desk', conversationId: 1, text: 'ok' };
  },
}));
vi.mock('@/services/chat/channels', () => ({
  channelBySurface: () => ({
    memberOf: async (_orgId: string, sender: string) => (sender === '+19705550100' ? { userId: 'user_dana', name: 'Dana', email: 'dana@northwind.example' } : { userId: null, email: null }),
    signInHint: () => 'a mobile number on your Vocion profile',
  }),
}));
vi.mock('@/libs/surfaces/registry', () => ({
  getSurface: () => ({
    id: 'whatsapp',
    verify: () => ({ ok: false, reason: 'missing_secret' }),
    verifyAsync: async (raw: string) => (raw.includes('forged') ? { ok: false, reason: 'bad_signature' } : { ok: true }),
    parse: (f: Record<string, string>) => (f.Body ? { kind: 'message', inbound: { surface: 'whatsapp', teamId: null, channelId: f.To, threadRef: f.From, messageRef: 'SM1', externalUserId: f.From, text: f.Body, isDirect: true } } : { kind: 'ignore', reason: 'empty' }),
    reply: async (target: unknown, text: unknown) => {
      replies.push({ target, text });
      return null;
    },
  }),
}));

const { answerText, handleTextWebhook, TWILIO_WEBHOOK } = await import('./textWebhook');

function post(form: Record<string, string>): Request {
  return new Request('https://vocion.example/api/webhooks/twilio/whatsapp', { method: 'POST', body: new URLSearchParams(form).toString() });
}

describe('the text webhook', () => {
  it('refuses a request the surface could not verify, preferring the workspace\'s own secret', async () => {
    const res = await handleTextWebhook('whatsapp', post({ Body: 'forged' }), TWILIO_WEBHOOK);

    expect(res.status).toBe(401);
  });

  it('acks at once with the vendor\'s empty reply, also for a message it ignores', async () => {
    const res = await handleTextWebhook('whatsapp', post({ To: '+19705550199', From: '+19705550100' }), TWILIO_WEBHOOK);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/xml');
  });

  it('answers a member, and tells a stranger how to become one without running an agent', async () => {
    const { getSurface } = await import('@/libs/surfaces/registry');
    const adapter = getSurface('whatsapp')!;
    await answerText(adapter, { surface: 'whatsapp', teamId: null, channelId: '+19705550199', threadRef: '+19705550100', messageRef: 'SM1', externalUserId: '+19705550100', text: 'hi', isDirect: true });
    await answerText(adapter, { surface: 'whatsapp', teamId: null, channelId: '+19705550199', threadRef: '+19705550123', messageRef: 'SM2', externalUserId: '+19705550123', text: 'hi', isDirect: true });
    await answerText(adapter, { surface: 'whatsapp', teamId: null, channelId: '+19705550111', threadRef: '+19705550100', messageRef: 'SM3', externalUserId: '+19705550100', text: 'hi', isDirect: true });

    expect(answered).toHaveLength(1);
    expect(replies).toEqual([{ target: { channelId: '+19705550199', threadRef: '+19705550123' }, text: expect.stringMatching(/add a mobile number on your Vocion profile/) }]);
  });
});
