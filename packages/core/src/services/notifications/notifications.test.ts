/**
 * The notification noun end to end against PGlite (backlog 048): a declared
 * rule on the event bus, `notify()`'s one row per person and its dedupe, the
 * delivery plan, and the queue — retries, give-up, a gone device removed, a
 * failed channel never blocking the others, mail grouped. Channel senders are
 * injected: nothing here calls APNs, a push service, Slack or Resend.
 */
import type { Senders } from './delivery';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { and, eq } = await import('drizzle-orm');
const schema = await import('@/models/Schema');
const { accountMembershipSchema, eventLogSchema, liveNoticeSchema, notificationDeliverySchema, notificationPreferenceSchema, notificationRuleSchema, notificationSchema, projectSchema, pushSubscriptionSchema, tenantAccountSchema, userSchema } = schema;
const { notify, planDeliveries, markRead, EMAIL_GROUP_MS } = await import('./notify');
const { deliverDue, MAX_ATTEMPTS } = await import('./delivery');
const { renderNotification } = await import('./rules');
const { listNotifications, unreadCount } = await import('./inbox');
const { emitEvent } = await import('@/services/EventService');

const ACCOUNT = 'acct-notify-northwind';
const ORG = 'proj-notify-northwind';
const RILEY = 'usr-notify-riley'; // admin, accountable
const SAM = 'usr-notify-sam'; // member

const ENV_KEYS = ['VOCION_VAPID_PUBLIC_KEY', 'VOCION_VAPID_PRIVATE_KEY', 'VOCION_APNS_KEY', 'VOCION_APNS_KEY_ID', 'VOCION_APNS_TEAM_ID', 'VOCION_APNS_BUNDLE_ID', 'SLACK_BOT_TOKEN', 'VOCION_MAIL_ENABLED'] as const;
const saved: Record<string, string | undefined> = {};

function configureEverything() {
  Object.assign(process.env, {
    VOCION_VAPID_PUBLIC_KEY: 'test-public',
    VOCION_VAPID_PRIVATE_KEY: 'test-private',
    VOCION_APNS_KEY: 'test-key',
    VOCION_APNS_KEY_ID: 'KEYID00001',
    VOCION_APNS_TEAM_ID: 'TEAMID0001',
    VOCION_APNS_BUNDLE_ID: 'app.example.vocion',
    SLACK_BOT_TOKEN: 'xoxb-test',
    VOCION_MAIL_ENABLED: '1',
  });
}

beforeEach(async () => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  await db.delete(notificationDeliverySchema);
  await db.delete(notificationSchema);
  await db.delete(notificationRuleSchema);
  await db.delete(notificationPreferenceSchema);
  await db.delete(pushSubscriptionSchema);
  await db.delete(eventLogSchema);
  await db.delete(projectSchema).where(eq(projectSchema.id, ORG));
  await db.delete(accountMembershipSchema).where(eq(accountMembershipSchema.accountId, ACCOUNT));
  await db.delete(userSchema).where(eq(userSchema.id, RILEY));
  await db.delete(userSchema).where(eq(userSchema.id, SAM));
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.id, ACCOUNT));
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-notify' });
  await db.insert(userSchema).values([{ id: RILEY, email: 'riley@northwind.example', name: 'Riley' }, { id: SAM, email: 'sam@northwind.example', name: 'Sam' }]);
  await db.insert(accountMembershipSchema).values([{ accountId: ACCOUNT, userId: RILEY, role: 'admin' }, { accountId: ACCOUNT, userId: SAM, role: 'member' }]);
  await db.insert(projectSchema).values({ id: ORG, accountId: ACCOUNT, slug: 'northwind', name: 'Northwind Factory', accountableUserId: RILEY });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = saved[k];
    }
  }
});

const ALL_SERVER = { ios: true, web: true, email: true, slack: true, sms: true };

describe('planDeliveries', () => {
  const now = new Date('2026-09-30T18:00:00Z');
  const prefs = { channels: {}, quietHours: null, slackTarget: 'dm' as const };

  it('in-app on write; push per registered device; nothing for a platform with no device', () => {
    const plan = planDeliveries({ kind: 'released', prefs, devices: [{ id: 1, platform: 'web' }, { id: 2, platform: 'web' }], server: ALL_SERVER, now });

    expect(plan.map(p => [p.channel, p.subscriptionId, p.status])).toEqual([['in_app', null, 'sent'], ['web', 1, 'pending'], ['web', 2, 'pending']]);
  });

  it('email waits a minute to group; a channel the server cannot send is skipped with why', () => {
    const plan = planDeliveries({ kind: 'released', prefs: { ...prefs, channels: { released: { email: true, slack: true } } }, devices: [{ id: 3, platform: 'ios' }], server: { ...ALL_SERVER, ios: false }, now });
    const email = plan.find(p => p.channel === 'email')!;

    expect(email.nextAttemptAt.getTime()).toBe(now.getTime() + EMAIL_GROUP_MS);

    const ios = plan.find(p => p.channel === 'ios')!;

    expect(ios.status).toBe('skipped');
    expect(ios.detail).toMatch(/not configured.*VOCION_APNS_KEY/);
    expect(plan.find(p => p.channel === 'slack')!.status).toBe('pending');
  });

  it('holds push inside quiet hours until they end; in-app never waits', () => {
    const plan = planDeliveries({ kind: 'released', prefs: { ...prefs, quietHours: { start: '17:00', end: '19:00', timeZone: 'UTC' } }, devices: [{ id: 1, platform: 'web' }], server: ALL_SERVER, now });

    expect(plan.find(p => p.channel === 'in_app')!.status).toBe('sent');
    expect(plan.find(p => p.channel === 'web')!.nextAttemptAt.toISOString()).toBe('2026-09-30T19:00:00.000Z');
  });
});

describe('notify', () => {
  it('writes one notification per person, once per dedupe key', async () => {
    const first = await notify({ orgId: ORG, kind: 'needs-person', userIds: [RILEY, SAM, RILEY], title: 'Open alerts needs you', dedupeKey: 'needs-person:request:12:ask:40' }, { deliver: 'none' });

    expect(first.created).toHaveLength(2);

    const again = await notify({ orgId: ORG, kind: 'needs-person', userIds: [RILEY], title: 'Open alerts needs you', dedupeKey: 'needs-person:request:12:ask:40' }, { deliver: 'none' });

    expect(again).toEqual({ created: [], deduped: 1 });
    expect(await unreadCount(RILEY, ORG)).toBe(1);

    const [delivery] = await db.select().from(notificationDeliverySchema).where(eq(notificationDeliverySchema.notificationId, first.created[0]!));

    expect(delivery).toMatchObject({ channel: 'in_app', status: 'sent' });
  });

  it('publishes itself on the live stream: written and read each ring the person\'s topic', async () => {
    await db.delete(liveNoticeSchema);
    const out = await notify({ orgId: ORG, kind: 'released', userIds: [RILEY], title: 'Released', dedupeKey: 'released:release:77' }, { deliver: 'none' });
    await markRead(RILEY, ORG, out.created);
    const notices = await db.select().from(liveNoticeSchema).where(eq(liveNoticeSchema.orgId, ORG));

    expect(notices.map(n => [n.topics, n.ref, n.kind])).toEqual([
      [[`notification:${RILEY}`], `notification:${out.created[0]}`, 'created'],
      [[`notification:${RILEY}`], `notification:${out.created[0]}`, 'changed'],
    ]);
  });

  it('marks read, only the person\'s own', async () => {
    const out = await notify({ orgId: ORG, kind: 'released', userIds: [RILEY, SAM], title: 'Released: Light theme toggle is live', dedupeKey: 'released:release:5' }, { deliver: 'none' });

    expect(await markRead(RILEY, ORG, out.created)).toBe(1);
    expect(await unreadCount(RILEY, ORG)).toBe(0);
    expect(await unreadCount(SAM, ORG)).toBe(1);
    expect(await markRead(SAM, ORG, 'all')).toBe(1);
  });
});

describe('the delivery queue', () => {
  async function withDevices() {
    configureEverything();
    const [web] = await db.insert(pushSubscriptionSchema).values({ userId: RILEY, platform: 'web', token: 'https://push.example.com/sub/riley', keys: { p256dh: 'p', auth: 'a' }, label: 'Chrome on macOS' }).returning();
    const [ios] = await db.insert(pushSubscriptionSchema).values({ userId: RILEY, platform: 'ios', token: 'cd'.repeat(32), bundleId: 'app.example.vocion', environment: 'production', label: 'iPhone' }).returning();
    return { web: web!, ios: ios! };
  }

  function senders(over: Partial<Senders>): Partial<Senders> {
    return {
      web: vi.fn(async () => ({ status: 'sent' as const })),
      ios: vi.fn(async () => ({ status: 'sent' as const })),
      slack: vi.fn(async () => ({ status: 'sent' as const })),
      email: vi.fn(async () => ({ status: 'sent' as const })),
      ...over,
    };
  }

  it('a failed channel never blocks another; it retries with its reason, then gives up visibly', async () => {
    await withDevices();
    const now = new Date('2026-09-30T18:00:00Z');
    const { created } = await notify({ orgId: ORG, kind: 'released', userIds: [RILEY], title: 'Released: Dark mode is live', dedupeKey: 'released:release:9' }, { deliver: 'none', now });
    const ios = vi.fn(async () => ({ status: 'retry' as const, error: 'APNs answered 503' }));
    const send = senders({ ios });
    const first = await deliverDue({ now, send });

    expect(first).toMatchObject({ claimed: 2, sent: 1, retrying: 1 });

    const rows = await db.select().from(notificationDeliverySchema).where(eq(notificationDeliverySchema.notificationId, created[0]!));

    expect(rows.find(r => r.channel === 'web')!.status).toBe('sent');

    const iosRow = rows.find(r => r.channel === 'ios')!;

    expect(iosRow.status).toBe('pending');
    expect(iosRow.detail).toMatch(/attempt 1 of 5 failed, retrying: APNs answered 503/);
    expect(iosRow.nextAttemptAt.getTime()).toBe(now.getTime() + 30_000);

    // Not due yet: nothing is claimed.
    expect((await deliverDue({ now: new Date(now.getTime() + 10_000), send })).claimed).toBe(0);

    let t = now.getTime();
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      t += 60 * 60_000;
      await deliverDue({ now: new Date(t), send });
    }
    const [dead] = await db.select().from(notificationDeliverySchema).where(and(eq(notificationDeliverySchema.notificationId, created[0]!), eq(notificationDeliverySchema.channel, 'ios')));

    expect(dead!.status).toBe('failed');
    expect(dead!.detail).toMatch(/gave up after 5 attempts: APNs answered 503/);
    expect(ios).toHaveBeenCalledTimes(MAX_ATTEMPTS);

    // What the person reads says so.
    const page = await listNotifications(RILEY, ORG);

    expect(page.items[0]!.deliveries.map(d => [d.channelLabel, d.status])).toEqual([['In-app', 'sent'], ['iPhone', 'failed'], ['Chrome', 'sent']]);
  });

  it('removes a device the push service calls gone', async () => {
    const { web } = await withDevices();
    const now = new Date('2026-09-30T18:00:00Z');
    await notify({ orgId: ORG, kind: 'released', userIds: [RILEY], title: 'Released', dedupeKey: 'released:release:10' }, { deliver: 'none', now });
    await deliverDue({ now, send: senders({ web: vi.fn(async () => ({ status: 'gone' as const, error: 'the browser\'s subscription has expired (410)' })) }) });

    expect(await db.select().from(pushSubscriptionSchema).where(eq(pushSubscriptionSchema.id, web.id))).toHaveLength(0);

    const [row] = await db.select().from(notificationDeliverySchema).where(eq(notificationDeliverySchema.channel, 'web'));

    expect(row).toMatchObject({ status: 'failed' });
    expect(row!.detail).toMatch(/removed/);
  });

  it('groups mail that lands within a minute into one message', async () => {
    configureEverything();
    await db.insert(notificationPreferenceSchema).values({ userId: RILEY, orgId: ORG, channels: { 'released': { email: true, ios: false, web: false }, 'needs-person': { email: true } } });
    const now = new Date('2026-09-30T18:00:00Z');
    await notify({ orgId: ORG, kind: 'released', userIds: [RILEY], title: 'Released: A', dedupeKey: 'released:release:1' }, { deliver: 'none', now });
    await notify({ orgId: ORG, kind: 'needs-person', userIds: [RILEY], title: 'B needs you', dedupeKey: 'needs-person:request:2:ask:3' }, { deliver: 'none', now: new Date(now.getTime() + 20_000) });
    const email = vi.fn(async () => ({ status: 'sent' as const }));

    // Nothing is due inside the minute.
    expect((await deliverDue({ now: new Date(now.getTime() + 30_000), send: senders({ email }) })).claimed).toBe(0);

    const out = await deliverDue({ now: new Date(now.getTime() + EMAIL_GROUP_MS + 1), send: senders({ email }) });

    expect(out).toMatchObject({ claimed: 2, sent: 2 });
    expect(email).toHaveBeenCalledTimes(1);

    const grouped = (email.mock.calls[0] as unknown as [unknown, Array<{ title: string }>])[1];

    expect(grouped.map(n => n.title).sort()).toEqual(['B needs you', 'Released: A']);
  });

  it('a sender that throws is a retry, never a lost row', async () => {
    await withDevices();
    const now = new Date('2026-09-30T18:00:00Z');
    await notify({ orgId: ORG, kind: 'released', userIds: [RILEY], title: 'Released', dedupeKey: 'released:release:11' }, { deliver: 'none', now });
    await deliverDue({ now, send: senders({ web: vi.fn(async () => {
      throw new Error('socket hang up');
    }) }) });
    const [row] = await db.select().from(notificationDeliverySchema).where(eq(notificationDeliverySchema.channel, 'web'));

    expect(row).toMatchObject({ status: 'pending' });
    expect(row!.detail).toMatch(/socket hang up/);
  });
});

describe('declared, never implicit: the event bus', () => {
  const RULE = {
    kind: 'needs-person',
    label: 'Needs a person',
    event: 'factory.stopped',
    who: 'accountable' as const,
    title: '{title} needs you',
    body: '{why}. What would unblock it: {unblock}.',
    record: { type: 'request', id: '{requestId}' },
    dedupe: 'request:{requestId}:ask:{askId}',
  };
  const STOP = { requestId: 12, title: 'Open alerts', askId: 40, why: 'the last attempt made no changes', unblock: 'press Build with a note', line: 'x', attempts: 3, failure: 'no_changes' };

  it('renders a rule\'s templates from the payload', () => {
    expect(renderNotification(RULE, STOP, '1')).toEqual({
      title: 'Open alerts needs you',
      body: 'the last attempt made no changes. What would unblock it: press Build with a note.',
      record: { type: 'request', id: '12' },
      path: null,
      dedupeKey: 'needs-person:request:12:ask:40',
    });
    expect(renderNotification({ ...RULE, dedupe: undefined, title: '{missing}' }, STOP, '1')).toMatchObject({ title: 'Needs a person', dedupeKey: 'needs-person:request:12' });
  });

  it('a declared event notifies the accountable person once, opening the record', async () => {
    await db.insert(notificationRuleSchema).values({ orgId: ORG, kind: RULE.kind, label: RULE.label, event: RULE.event, source: 'plugin:software-factory', config: RULE });
    await emitEvent({ orgId: ORG, type: 'factory.stopped', payload: STOP, dedupeKey: 'factory.stopped:12:40' });
    // The sweep re-raising the same stop under another key is still one notification.
    await emitEvent({ orgId: ORG, type: 'factory.stopped', payload: STOP, dedupeKey: 'factory.stopped:12:40:again' });
    const rows = await db.select().from(notificationSchema).where(eq(notificationSchema.orgId, ORG));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: RILEY, kind: 'needs-person', title: 'Open alerts needs you', recordType: 'request', recordId: '12', eventType: 'factory.stopped' });
    expect(rows[0]!.link).toMatch(/^\/w\/northwind\/dashboard\//);

    const [rule] = await db.select().from(notificationRuleSchema).where(eq(notificationRuleSchema.orgId, ORG));

    expect(rule!.lastNote).toBe('raised again for a record already notified — nobody was notified twice');
    expect(rule!.lastFiredAt).not.toBeNull();

    // A later stop on the same request is a new ask, and a new notification.
    await emitEvent({ orgId: ORG, type: 'factory.stopped', payload: { ...STOP, askId: 41 }, dedupeKey: 'factory.stopped:12:41' });

    expect(await db.select().from(notificationSchema).where(eq(notificationSchema.orgId, ORG))).toHaveLength(2);
  });

  it('an event nobody declared, or one the filter refuses, notifies nobody', async () => {
    await db.insert(notificationRuleSchema).values({ orgId: ORG, kind: 'released', label: 'Released', event: 'release.linked', config: { kind: 'released', label: 'Released', event: 'release.linked', filter: { userFacing: true }, who: 'accountable', title: 'Released: {headline} {liveVerb}' } });
    await emitEvent({ orgId: ORG, type: 'worker_run.completed', payload: { workerRunId: 1 } });
    await emitEvent({ orgId: ORG, type: 'release.linked', payload: { releaseId: 3, userFacing: false, headline: null, liveVerb: 'is live' } });

    expect(await db.select().from(notificationSchema).where(eq(notificationSchema.orgId, ORG))).toHaveLength(0);

    await emitEvent({ orgId: ORG, type: 'release.linked', payload: { releaseId: 4, userFacing: true, headline: 'Light theme toggle', liveVerb: 'is live' } });
    const [n] = await db.select().from(notificationSchema).where(eq(notificationSchema.orgId, ORG));

    expect(n).toMatchObject({ userId: RILEY, title: 'Released: Light theme toggle is live' });
  });

  it('with no accountable person, the admins hear it and the rule says so', async () => {
    await db.update(projectSchema).set({ accountableUserId: null }).where(eq(projectSchema.id, ORG));
    await db.insert(notificationRuleSchema).values({ orgId: ORG, kind: RULE.kind, label: RULE.label, event: RULE.event, config: RULE });
    await emitEvent({ orgId: ORG, type: 'factory.stopped', payload: STOP, dedupeKey: 'factory.stopped:12:40' });
    const rows = await db.select().from(notificationSchema).where(eq(notificationSchema.orgId, ORG));

    expect(rows.map(r => r.userId)).toEqual([RILEY]);

    const [rule] = await db.select().from(notificationRuleSchema).where(eq(notificationRuleSchema.orgId, ORG));

    expect(rule!.lastNote).toMatch(/no accountable user is set, so the admin heard it/);
  });
});
