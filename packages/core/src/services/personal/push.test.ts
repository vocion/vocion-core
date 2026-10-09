/**
 * Push to the person, against PGlite: the brief and urgent items reach the
 * channels Alex chose — with a link straight to the item and a one-tap stop —
 * and never when he said not to: the wrong mode, quiet hours, a second time,
 * or past the hourly limit. Every push is also in the app, whatever happens.
 */
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, askSchema, notificationSchema, personalRhythmSchema, projectMemberSchema, projectSchema, rateLimitHitSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { setRhythm } = await import('@/services/personal/rhythm/schedule');
const { pushToPerson } = await import('./push');
const { sweepUrgent } = await import('./urgent');
const { readStopToken, stopToken } = await import('@/libs/personal/stopLink');
const { isBrokenConnection } = await import('@/libs/personal/broken');
const { GoogleCallError } = await import('@/libs/personal/google');
const { SlackCallError } = await import('@/libs/personal/slack');
const { GoogleRefreshRefused } = await import('@/libs/sources/googleAuth');
const stopRoute = await import('@/app/api/personal/push/stop/route');

const ACCOUNT = 'acct-push-northwind';
const ALEX = 'usr-push-alex';
const REVENUE = 'proj-push-revenue';
const TZ = 'America/Los_Angeles';
const NOON = new Date('2026-10-09T19:00:00Z'); // 12:00 in Los Angeles

let home: { id: string; slug: string };
type Sent = { channel: string; to: unknown; title: string; body: string; url: string; stopUrl: string };
let sent: Sent[];
type Message = { title: string; body: string; url: string; stopUrl: string };
function recorder(channel: string) {
  return async (to: unknown, m: Message) => {
    sent.push({ channel, to, ...m });
    return 'sent';
  };
}
const senders = { slack: recorder('slack'), sms: recorder('sms'), email: recorder('email') };

function item(over: Partial<Parameters<typeof pushToPerson>[0]> = {}): Parameters<typeof pushToPerson>[0] {
  return { userId: ALEX, accountId: ACCOUNT, kind: 'urgent', key: `k-${Math.random()}`, title: 'Waiting on you', body: 'An approval is holding its run.', path: '/dashboard/inbox', workspaceSlug: 'revenue-push', accountSlug: 'northwind-push', ...over };
}

beforeAll(async () => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'push-test-secret';
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-push' });
  await db.insert(userSchema).values({ id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera', phone: '+15555550100' });
  await db.insert(accountMembershipSchema).values({ accountId: ACCOUNT, userId: ALEX, role: 'member' });
  await db.insert(projectSchema).values({ id: REVENUE, accountId: ACCOUNT, slug: 'revenue-push', name: 'Revenue Team' });
  await db.insert(projectMemberSchema).values({ projectId: REVENUE, userId: ALEX, role: 'member' });
  home = await ensurePersonalProject(ALEX, ACCOUNT);
});

beforeEach(async () => {
  sent = [];
  await db.delete(notificationSchema);
  await db.delete(rateLimitHitSchema);
  await db.delete(askSchema);
  await db.delete(personalRhythmSchema);
  await setRhythm(ALEX, ACCOUNT, { timeZone: TZ, pushChannels: ['slack', 'email'] }, NOON);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('a push', () => {
  it('reaches each channel he chose, opening the app on the item, with a stop for that channel', async () => {
    const out = await pushToPerson(item({ path: '/dashboard/chat?conversation=41', workspaceSlug: home.slug }), { now: NOON, senders });

    expect(out).toEqual({ pushed: true, channels: [{ channel: 'slack', status: 'sent' }, { channel: 'email', status: 'sent' }] });
    expect(sent.map(s => s.channel)).toEqual(['slack', 'email']);
    expect(sent[0]!.url).toContain(`/w/${home.slug}/dashboard/chat?conversation=41`);

    const stop = new URL(sent[1]!.stopUrl, 'http://x');

    expect(readStopToken(stop.searchParams.get('t'))).toEqual({ userId: ALEX, accountId: ACCOUNT, channel: 'email' });
  });

  it('is in the app either way, and is never pushed twice', async () => {
    const one = item({ key: 'approval:42' });

    await pushToPerson(one, { now: NOON, senders });
    const again = await pushToPerson(one, { now: NOON, senders });

    expect(again).toEqual({ pushed: false, reason: 'already' });
    expect(sent).toHaveLength(2);

    const inApp = await db.select().from(notificationSchema).where(and(eq(notificationSchema.userId, ALEX), eq(notificationSchema.orgId, home.id)));

    expect(inApp.map(n => n.kind)).toEqual(['personal-urgent']);
  });

  it('with no channel chosen, lands in the app only', async () => {
    await setRhythm(ALEX, ACCOUNT, { pushChannels: [] }, NOON);

    const out = await pushToPerson(item(), { now: NOON, senders });

    expect(out).toEqual({ pushed: false, reason: 'no_channels' });
    expect(sent).toEqual([]);
    expect(await db.select().from(notificationSchema)).toHaveLength(1);
  });

  it('urgent only: the brief does not push, urgent items still do', async () => {
    await setRhythm(ALEX, ACCOUNT, { pushMode: 'urgent' }, NOON);

    await expect(pushToPerson(item({ kind: 'brief' }), { now: NOON, senders })).resolves.toEqual({ pushed: false, reason: 'mode' });
    await expect(pushToPerson(item({ kind: 'urgent' }), { now: NOON, senders })).resolves.toMatchObject({ pushed: true });
  });

  it('nothing leaves the app inside quiet hours', async () => {
    await setRhythm(ALEX, ACCOUNT, { quietStart: '11:00', quietEnd: '13:00' }, NOON);

    await expect(pushToPerson(item(), { now: NOON, senders })).resolves.toEqual({ pushed: false, reason: 'quiet' });
    expect(sent).toEqual([]);
  });

  it('stops at six an hour; the seventh is in the app only', async () => {
    vi.stubEnv('VOCION_RATE_LIMIT', '');
    const outs = [];
    for (let i = 0; i < 7; i++) {
      outs.push(await pushToPerson(item(), { now: NOON, senders }));
    }

    expect(outs.slice(0, 6).every(o => o.pushed)).toBe(true);
    expect(outs[6]).toEqual({ pushed: false, reason: 'rate_limited' });
    expect(await db.select().from(notificationSchema)).toHaveLength(7);
  });
});

describe('the one-tap stop', () => {
  it('turns that one channel off, with no sign-in, and says so', async () => {
    const t = stopToken({ userId: ALEX, accountId: ACCOUNT, channel: 'email' });

    const res = await stopRoute.GET(new NextRequest(`https://agents.example/api/personal/push/stop?t=${encodeURIComponent(t)}`));

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Stopped');

    const [row] = await db.select({ channels: personalRhythmSchema.pushChannels }).from(personalRhythmSchema).where(eq(personalRhythmSchema.userId, ALEX));

    expect(row!.channels).toEqual(['slack']);
  });

  it('refuses a token this server did not sign, and changes nothing', async () => {
    const t = stopToken({ userId: ALEX, accountId: ACCOUNT, channel: 'slack' });
    const forged = `${Buffer.from(JSON.stringify(['usr-someone-else', ACCOUNT, 'slack'])).toString('base64url')}.${t.split('.')[1]}`;

    const res = await stopRoute.POST(new NextRequest(`https://agents.example/api/personal/push/stop?t=${forged}`, { method: 'POST' }));

    expect(res.status).toBe(400);
    expect(readStopToken(forged)).toBeNull();
  });
});

describe('what is urgent', () => {
  it('pushes a new approval on him, linked to its row — but not what waited before push was on', async () => {
    await db.insert(askSchema).values({ orgId: REVENUE, kind: 'approval', title: 'Approve the Contoso Supply refund?', status: 'open', createdBy: ALEX, ownerUserId: ALEX, createdAt: new Date('2026-10-09T10:00:00Z'), updatedAt: new Date('2026-10-09T10:00:00Z') });
    const pushed: Array<Parameters<typeof pushToPerson>[0]> = [];
    const push = async (i: Parameters<typeof pushToPerson>[0]) => {
      pushed.push(i);
      return { pushed: true as const, channels: [] };
    };

    await sweepUrgent(new Date('2026-10-09T18:00:00Z'), push);
    await db.insert(askSchema).values({ orgId: REVENUE, kind: 'approval', title: 'Approve the Kestrel Capital invoice?', status: 'open', createdBy: ALEX, ownerUserId: ALEX, createdAt: new Date('2026-10-09T18:30:00Z'), updatedAt: new Date('2026-10-09T18:30:00Z') });
    await sweepUrgent(NOON, push);
    await sweepUrgent(new Date(NOON.getTime() + 5 * 60_000), push);

    expect(pushed.map(p => p.title)).toEqual(['Waiting on you: Approve the Kestrel Capital invoice?']);
    expect(pushed[0]!.path).toContain('/w/revenue-push/');
  });

  it('holds what arrives in quiet hours and pushes it when they end', async () => {
    await setRhythm(ALEX, ACCOUNT, { quietStart: '11:00', quietEnd: '13:00' }, NOON);
    await db.update(personalRhythmSchema).set({ urgentSeenAt: new Date('2026-10-09T17:00:00Z') }).where(eq(personalRhythmSchema.userId, ALEX));
    await db.insert(askSchema).values({ orgId: REVENUE, kind: 'approval', title: 'Approve the Bellwater Hall deposit?', status: 'open', createdBy: ALEX, ownerUserId: ALEX, createdAt: new Date('2026-10-09T18:30:00Z'), updatedAt: new Date('2026-10-09T18:30:00Z') });
    const pushed: string[] = [];
    const push = async (i: Parameters<typeof pushToPerson>[0]) => {
      pushed.push(i.title);
      return { pushed: true as const, channels: [] };
    };

    await sweepUrgent(NOON, push);

    expect(pushed).toEqual([]);

    await sweepUrgent(new Date('2026-10-09T20:05:00Z'), push);

    expect(pushed).toEqual(['Waiting on you: Approve the Bellwater Hall deposit?']);
  });

  it('a broken connection is one that only reconnecting fixes', () => {
    expect(isBrokenConnection(new GoogleRefreshRefused('revoked', 'log-in-again'))).toBe(true);
    expect(isBrokenConnection(new GoogleRefreshRefused('later', 'try-later'))).toBe(false);
    expect(isBrokenConnection(new GoogleCallError('the calendar', 401))).toBe(true);
    expect(isBrokenConnection(new GoogleCallError('the calendar', 503))).toBe(false);
    expect(isBrokenConnection(new SlackCallError('token_revoked'))).toBe(true);
    expect(isBrokenConnection(new SlackCallError('ratelimited'))).toBe(false);
  });
});
