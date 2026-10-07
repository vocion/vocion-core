/**
 * Notifications by text message, against PGlite: off until a person turns it
 * on for a kind, sent to the number on their profile from the account's
 * shared number (else the workspace's own), within one text, and a missing
 * number or binding said as the delivery's reason. Twilio is never called:
 * the sender is injected. Every number is in the undialable 555 exchange.
 */
import type { NotificationMessage } from '@/libs/notifications/outcome';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { eq, inArray } = await import('drizzle-orm');
const { accountMembershipSchema, chatChannelBindingSchema, notificationDeliverySchema, notificationPreferenceSchema, notificationSchema, projectSchema, pushSubscriptionSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { notify, planDeliveries } = await import('./notify');
const { deliverDue, smsTargetFor } = await import('./delivery');
const { setPreferences } = await import('./preferences');
const { sendSmsNotification, smsNotificationText } = await import('@/libs/notifications/sms');
const { SMS_MAX } = await import('@/libs/surfaces/sms');
const { SENDERS_OWN_ASSISTANT } = await import('@/services/chat/ownAssistant');

const ACCOUNT = 'acct-smsnote-northwind';
const ORG = 'proj-smsnote-factory';
const OTHER = 'proj-smsnote-revenue';
const RILEY = 'usr-smsnote-riley';
const SAM = 'usr-smsnote-sam';
const RILEY_PHONE = '+19705550111';

const TWILIO = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const k of TWILIO) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  await db.delete(notificationDeliverySchema);
  await db.delete(notificationSchema);
  await db.delete(notificationPreferenceSchema);
  await db.delete(pushSubscriptionSchema);
  await db.delete(chatChannelBindingSchema);
  await db.delete(projectSchema).where(eq(projectSchema.accountId, ACCOUNT));
  await db.delete(accountMembershipSchema).where(eq(accountMembershipSchema.accountId, ACCOUNT));
  await db.delete(userSchema).where(inArray(userSchema.id, [RILEY, SAM]));
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.id, ACCOUNT));
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-sms' });
  await db.insert(userSchema).values([{ id: RILEY, email: 'riley@northwind.example', name: 'Riley', phone: RILEY_PHONE }, { id: SAM, email: 'sam@northwind.example', name: 'Sam' }]);
  await db.insert(accountMembershipSchema).values([{ accountId: ACCOUNT, userId: RILEY, role: 'admin' }, { accountId: ACCOUNT, userId: SAM, role: 'member' }]);
  await db.insert(projectSchema).values([{ id: ORG, accountId: ACCOUNT, slug: 'factory', name: 'Northwind Factory' }, { id: OTHER, accountId: ACCOUNT, slug: 'revenue', name: 'Revenue' }]);
});

afterEach(() => {
  for (const k of TWILIO) {
    if (saved[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = saved[k];
    }
  }
});

const SERVER = { ios: true, web: true, email: true, slack: true, sms: true };
const now = new Date('2026-10-07T18:00:00Z');

describe('planDeliveries', () => {
  it('sends no text until the person turns it on for the kind', () => {
    const off = planDeliveries({ kind: 'released', prefs: { channels: {}, quietHours: null, slackTarget: 'dm' }, devices: [], server: SERVER, now });

    expect(off.map(p => p.channel)).toEqual(['in_app']);

    const on = planDeliveries({ kind: 'released', prefs: { channels: { released: { sms: true } }, quietHours: null, slackTarget: 'dm' }, devices: [], server: SERVER, now });

    expect(on.map(p => [p.channel, p.status])).toEqual([['in_app', 'sent'], ['sms', 'pending']]);
  });

  it('skips a text with the reason when the server has no Twilio account, and holds it through quiet hours', () => {
    const prefs = { channels: { released: { sms: true } }, quietHours: null, slackTarget: 'dm' as const };
    const skipped = planDeliveries({ kind: 'released', prefs, devices: [], server: { ...SERVER, sms: false }, now }).find(p => p.channel === 'sms')!;

    expect(skipped.status).toBe('skipped');
    expect(skipped.detail).toMatch(/TWILIO_ACCOUNT_SID/);

    const held = planDeliveries({ kind: 'released', prefs: { ...prefs, quietHours: { start: '17:00', end: '19:00', timeZone: 'UTC' } }, devices: [], server: SERVER, now }).find(p => p.channel === 'sms')!;

    expect(held.nextAttemptAt.toISOString()).toBe('2026-10-07T19:00:00.000Z');
  });
});

describe('smsTargetFor', () => {
  it('texts from the account\'s shared number first, else the workspace\'s own, never another workspace\'s', async () => {
    await db.insert(chatChannelBindingSchema).values({ orgId: OTHER, surface: 'sms', channelId: '+19705550300', agentSlug: 'revenue-lead' });

    expect(await smsTargetFor(ORG, RILEY)).toEqual({ error: expect.stringMatching(/no text number is bound/) });

    await db.insert(chatChannelBindingSchema).values({ orgId: ORG, surface: 'sms', channelId: '+19705550200', agentSlug: 'factory-lead' });

    expect(await smsTargetFor(ORG, RILEY)).toEqual({ from: '+19705550200', to: RILEY_PHONE });

    // The shared number is bound in another workspace of the account, and still wins.
    await db.insert(chatChannelBindingSchema).values({ orgId: OTHER, surface: 'sms', channelId: '+19705550100', agentSlug: SENDERS_OWN_ASSISTANT });

    expect(await smsTargetFor(ORG, RILEY)).toEqual({ from: '+19705550100', to: RILEY_PHONE });
  });

  it('says so when the person has no mobile number', async () => {
    expect(await smsTargetFor(ORG, SAM)).toEqual({ error: expect.stringMatching(/no mobile number/) });
  });
});

describe('sendSmsNotification', () => {
  const message: NotificationMessage = { id: 1, kind: 'released', title: 'Released: the Kestrel Capital import', body: 'x'.repeat(4000), url: 'https://app.vocion.example/w/factory/dashboard/inbox/42' };

  it('is not configured without a Twilio account', async () => {
    const send = vi.fn();

    expect(await sendSmsNotification({ from: '+19705550100', to: RILEY_PHONE }, message, send)).toMatchObject({ status: 'not_configured' });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends one text within SMS_MAX that keeps its link, and retries with Twilio\'s reason', async () => {
    Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'AC-test', TWILIO_AUTH_TOKEN: 'test-token' });
    const send = vi.fn(async (_from: string, _to: string, _body: string) => ({ sid: 'SM1' }));

    expect(await sendSmsNotification({ from: '+19705550100', to: RILEY_PHONE }, message, send)).toEqual({ status: 'sent' });

    const body = send.mock.calls[0]![2];

    expect(body.length).toBeLessThanOrEqual(SMS_MAX);
    expect(body.startsWith('Released: the Kestrel Capital import')).toBe(true);
    expect(body.endsWith(message.url!)).toBe(true);
    expect(smsNotificationText({ ...message, body: 'Short.' })).toBe(`Released: the Kestrel Capital import\nShort.\n${message.url}`);

    send.mockRejectedValueOnce(new Error('Twilio did not take the text: queue full'));

    expect(await sendSmsNotification({ from: '+19705550100', to: RILEY_PHONE }, message, send)).toEqual({ status: 'retry', error: 'Twilio: Twilio did not take the text: queue full' });
  });
});

describe('notify → deliver', () => {
  it('texts only the person who opted in, through the delivery pass', async () => {
    Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'AC-test', TWILIO_AUTH_TOKEN: 'test-token' });
    await setPreferences(RILEY, ORG, { channels: { released: { sms: true } } });
    const { created } = await notify({ orgId: ORG, kind: 'released', userIds: [RILEY, SAM], title: 'Released', dedupeKey: 'r1' }, { now, deliver: 'none' });

    expect(created).toHaveLength(2);

    const sms = vi.fn(async (_c: { userId: string; channel: string }) => ({ status: 'sent' as const }));
    await deliverDue({ now, send: { sms } });

    expect(sms).toHaveBeenCalledTimes(1);
    expect(sms.mock.calls[0]![0]).toMatchObject({ userId: RILEY, channel: 'sms' });

    const rows = await db.select().from(notificationDeliverySchema).where(eq(notificationDeliverySchema.channel, 'sms'));

    expect(rows.map(r => [r.userId, r.status])).toEqual([[RILEY, 'sent']]);
  });
});
