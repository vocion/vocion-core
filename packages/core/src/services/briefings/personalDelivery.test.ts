/**
 * The scheduled personal brief, against PGlite: who gets one and when (the
 * sweep), what is kept (one briefing per person, kind and day, on Briefings)
 * and what arrives (one short chat message that links to it).
 *
 * Northwind's Alex has a Personal workspace and is a member of Revenue Team,
 * where two decisions wait on him. The sweep must give him a rhythm without
 * him visiting a settings page, start each due delivery once, and skip one
 * the server slept through. A delivery must store his brief as a briefing in
 * his Personal workspace — what waits on him in the order to take it — post
 * one assistant message linking to it, and raise its suggested actions as one
 * Decision, recommended first — and only once a day, even when he already
 * asked for his day from the Briefings page.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, agentBudgetSchema, askSchema, briefingSchema, conversationMessageSchema, conversationSchema, missionRunSchema, notificationSchema, personalRhythmSchema, projectMemberSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { storeLoginCredential } = await import('@/services/ApiTokenService');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { getRhythm, setRhythm, sweepRhythms } = await import('@/services/personal/rhythm/schedule');
const { deliverPersonalBrief } = await import('./personalDelivery');
const { publishPersonalBrief, PERSONAL_BRIEF_PUBLISHER } = await import('./personal');
const { loadOpeningHints } = await import('@/services/chat/openingHints');

const ACCOUNT = 'acct-rh-northwind';
const ALEX = 'usr-rh-alex';
const CASS = 'usr-rh-cass';
const REVENUE = 'proj-rh-revenue';
const TZ = 'America/Los_Angeles';
const MORNING = new Date('2026-10-09T14:31:00Z'); // 07:31 in Los Angeles

let home: string;

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-rh' });
  await db.insert(userSchema).values([
    { id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera' },
    { id: CASS, email: 'cass@northwind.example', name: 'Cass Lund' },
  ]);
  await db.insert(accountMembershipSchema).values([
    // Alex was here yesterday; Cass, the Org's admin, has not been in for a month.
    { accountId: ACCOUNT, userId: ALEX, role: 'member', lastActiveAt: new Date('2026-10-08T18:00:00Z') },
    { accountId: ACCOUNT, userId: CASS, role: 'admin', lastActiveAt: new Date('2026-09-01T18:00:00Z') },
  ]);
  await db.insert(projectSchema).values({ id: REVENUE, accountId: ACCOUNT, slug: 'revenue-rh', name: 'Revenue Team' });
  await db.insert(projectMemberSchema).values({ projectId: REVENUE, userId: ALEX, role: 'member' });
  home = (await ensurePersonalProject(ALEX, ACCOUNT)).id;
});

beforeEach(async () => {
  await db.update(tenantAccountSchema).set({ dailyBriefs: true, briefDailyCents: null }).where(eq(tenantAccountSchema.id, ACCOUNT));
  await db.delete(agentBudgetSchema);
  await db.delete(notificationSchema);
  await db.delete(personalRhythmSchema);
  await db.delete(askSchema);
  await db.delete(conversationSchema).where(eq(conversationSchema.orgId, home));
  await db.delete(briefingSchema).where(eq(briefingSchema.orgId, home));
  await db.insert(askSchema).values([
    { orgId: REVENUE, kind: 'approval', title: 'Send the Contoso Supply renewal quote?', status: 'open', ownerUserId: ALEX, createdBy: ALEX, createdAt: new Date('2026-10-06T16:00:00Z'), updatedAt: new Date('2026-10-06T16:00:00Z') },
    { orgId: REVENUE, kind: 'ruling', title: 'Which Bellwater Hall date holds?', status: 'open', ownerUserId: ALEX, createdBy: ALEX, createdAt: new Date('2026-10-08T16:00:00Z'), updatedAt: new Date('2026-10-08T16:00:00Z') },
    // Cass took one overnight: the team's work since Alex last looked.
    { orgId: REVENUE, kind: 'approval', title: 'Archive the Kestrel Capital deck?', status: 'approved', decidedBy: CASS, decidedAt: new Date('2026-10-09T02:00:00Z') },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the sweep — who gets a brief, and when', () => {
  it('gives every Personal workspace a rhythm, with no settings visit, at the defaults', async () => {
    await sweepRhythms(new Date('2026-10-09T10:00:00Z'), async () => {});

    const [row] = await db.select().from(personalRhythmSchema).where(eq(personalRhythmSchema.userId, ALEX));

    expect(row).toMatchObject({ briefAt: '07:30', wrapAt: '17:30', briefOn: true, wrapOn: true });
    expect(row!.nextBriefAt).not.toBeNull();
  });

  it('starts a due brief once, under an id naming the person, the kind and their day, and moves it to tomorrow', async () => {
    await setRhythm(ALEX, ACCOUNT, { timeZone: TZ }, new Date('2026-10-09T13:00:00Z'));
    const started: string[] = [];

    const first = await sweepRhythms(MORNING, async (id) => {
      started.push(id);
    });
    const again = await sweepRhythms(new Date(MORNING.getTime() + 5 * 60_000), async (id) => {
      started.push(id);
    });

    expect(first.started).toEqual([{ userId: ALEX, accountId: ACCOUNT, kind: 'brief', day: '2026-10-09' }]);
    expect(again.started).toEqual([]);
    expect(started).toEqual([`personal-rhythm:${ALEX}:${ACCOUNT}:brief:2026-10-09`]);
    expect((await getRhythm(ALEX, ACCOUNT, MORNING)).nextBriefAt?.toISOString()).toBe('2026-10-10T14:30:00.000Z');
  });

  it('skips a brief the server slept through, rather than sending it at lunchtime', async () => {
    await setRhythm(ALEX, ACCOUNT, { timeZone: TZ }, new Date('2026-10-09T13:00:00Z'));

    const late = await sweepRhythms(new Date('2026-10-09T19:00:00Z'), async () => {});

    expect(late.started.filter(s => s.userId === ALEX)).toEqual([]);
    expect(late.skipped).toBeGreaterThan(0);
  });

  it('a person who turns the wrap off gets no wrap; times are refused unless they are HH:MM', async () => {
    const r = await setRhythm(ALEX, ACCOUNT, { wrapOn: false, briefAt: '06:45', timeZone: TZ }, new Date('2026-10-09T12:00:00Z'));

    expect(r).toMatchObject({ wrapOn: false, nextWrapAt: null, briefAt: '06:45', timeZone: TZ, zoneChosen: true });
    expect(r.nextBriefAt?.toISOString()).toBe('2026-10-09T13:45:00.000Z');
    await expect(setRhythm(ALEX, ACCOUNT, { briefAt: '7.30' })).rejects.toThrow(/HH:MM/);
  });
});

describe('the limits — briefs cost model money, so only where they are wanted', () => {
  it('starts none for someone who has not been here in seven days, and still moves their time on', async () => {
    await ensurePersonalProject(CASS, ACCOUNT);
    await setRhythm(CASS, ACCOUNT, { timeZone: TZ }, new Date('2026-10-09T13:00:00Z'));

    const out = await sweepRhythms(MORNING, async () => {});

    expect(out.started.filter(s => s.userId === CASS)).toEqual([]);
    expect(out.inactive).toBeGreaterThan(0);
    expect((await getRhythm(CASS, ACCOUNT, MORNING)).nextBriefAt?.toISOString()).toBe('2026-10-10T14:30:00.000Z');
  });

  it('starts none in an Org that turned daily briefs off', async () => {
    await db.update(tenantAccountSchema).set({ dailyBriefs: false }).where(eq(tenantAccountSchema.id, ACCOUNT));
    await setRhythm(ALEX, ACCOUNT, { timeZone: TZ }, new Date('2026-10-09T13:00:00Z'));

    const out = await sweepRhythms(MORNING, async () => {});

    expect(out.started).toEqual([]);
  });

  it('a day with nothing in it costs nothing: no model call, no message', async () => {
    await db.delete(askSchema);
    const writer = vi.fn(async () => null);

    const out = await deliverPersonalBrief({ userId: ALEX, accountId: ACCOUNT, kind: 'brief', day: '2026-10-09', timeZone: TZ, now: MORNING }, writer);

    expect(out).toEqual({ delivered: false, reason: 'nothing to say' });
    expect(writer).not.toHaveBeenCalled();
    expect(await db.select().from(conversationSchema).where(eq(conversationSchema.orgId, home))).toEqual([]);
    expect(await db.select().from(briefingSchema).where(eq(briefingSchema.orgId, home))).toEqual([]);
  });

  it('an Org past its daily brief budget gets no brief, and its admins one quiet notice', async () => {
    const cassHome = (await ensurePersonalProject(CASS, ACCOUNT)).id;
    await db.update(tenantAccountSchema).set({ briefDailyCents: 50 }).where(eq(tenantAccountSchema.id, ACCOUNT));
    // Briefs already spent 60 cents in the Org today, charged through the ordinary spend path.
    await db.insert(agentBudgetSchema).values({ orgId: cassHome, agentSlug: 'platform:personal.brief', feature: 'personal.brief', period: 'daily', currentTokens: 1, currentMicroCents: 60_000_000, periodStartedAt: new Date('2026-10-09T00:00:00Z') });
    const writer = vi.fn(async () => null);

    const out = await deliverPersonalBrief({ userId: ALEX, accountId: ACCOUNT, kind: 'brief', day: '2026-10-09', timeZone: TZ, now: MORNING }, writer);
    await deliverPersonalBrief({ userId: ALEX, accountId: ACCOUNT, kind: 'wrap', day: '2026-10-09', timeZone: TZ, now: MORNING }, writer);

    expect(out).toMatchObject({ delivered: false, reason: expect.stringContaining('daily brief budget') });
    expect(writer).not.toHaveBeenCalled();

    const notices = await db.select().from(notificationSchema).where(eq(notificationSchema.kind, 'briefs-paused'));

    expect(notices.map(n => n.userId)).toEqual([CASS]);
  });
});

describe('the delivery — one brief on Briefings, one message in chat', () => {
  const writer = vi.fn(async () => ({ meetings: [], actions: [
    { label: 'Approve the Contoso Supply renewal quote', why: 'It has waited three days on you.' },
    { label: 'Pick the Bellwater Hall date', why: 'Asked yesterday.' },
  ] }));
  const brief = () => deliverPersonalBrief({ userId: ALEX, accountId: ACCOUNT, kind: 'brief', day: '2026-10-09', timeZone: TZ, now: MORNING }, writer);
  const stored = async () => db.select().from(briefingSchema).where(eq(briefingSchema.orgId, home));
  const messagesOf = async (conversationId: number) => db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, conversationId));

  it('stores the brief as a briefing in his Personal workspace: what waits on him in order, and the team\'s night', async () => {
    const out = await brief();

    expect(out).toMatchObject({ delivered: true, orgId: home, title: 'Your day — Fri, Oct 9, 2026' });

    const rows = await stored();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: out.delivered ? out.briefingId : 0, publishedBy: PERSONAL_BRIEF_PUBLISHER, edition: 'brief:2026-10-09', title: 'Your day — Fri, Oct 9, 2026' });

    const text = rows[0]!.content;

    expect(text).toContain('**Good morning, Alex');
    // Calendar is not connected: the brief says so and where, never claims an empty day.
    expect(text).toContain('Google Calendar is not connected');
    // Oldest first: the order to take them.
    expect(text.indexOf('Contoso Supply renewal quote')).toBeLessThan(text.indexOf('Bellwater Hall date'));
    expect(text).toContain('**Revenue Team** — 1 decision taken');
    // The actions are the Decision's to draw; the brief only says where they are.
    expect(text).toContain('The 2 things to do first are waiting in Decisions.');
    expect(text).not.toContain('Approve the Contoso Supply renewal quote');
  });

  it('posts one short assistant message that says the lead line and links to the stored brief', async () => {
    const out = await brief();
    const messages = await messagesOf(out.delivered ? out.conversationId : 0);

    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('assistant');
    expect(messages[0]!.content).toContain('Good morning, Alex — Fri, Oct 9, 2026.');
    expect(messages[0]!.content).toMatch(new RegExp(`\\[Open Your day — Fri, Oct 9, 2026 →\\]\\(/w/[^)]+/dashboard/briefings/${out.delivered ? out.briefingId : 0}\\)`));
    // Short: the brief is on Briefings, not pasted into chat.
    expect(messages[0]!.content).not.toContain('## Waiting on you');
  });

  it('puts the suggested actions in one Decision, recommended first — raised after the message, so the chat is never empty under it', async () => {
    const out = await brief();

    const [ask] = await db.select().from(askSchema).where(and(eq(askSchema.orgId, home), eq(askSchema.conversationId, out.delivered ? out.conversationId : 0)));

    expect(ask).toMatchObject({ kind: 'ruling', ownerUserId: ALEX, status: 'open', allowOther: true });
    expect(ask!.options.map(o => [o.label, o.recommended ?? false])).toEqual([
      ['Approve the Contoso Supply renewal quote', true],
      ['Pick the Bellwater Hall date', false],
    ]);
  });

  it('is delivered once a day, however many times it is started', async () => {
    await brief();
    const again = await brief();

    expect(again).toMatchObject({ delivered: false, reason: 'already delivered' });
    expect(await db.select().from(conversationSchema).where(eq(conversationSchema.orgId, home))).toHaveLength(1);
    expect(await stored()).toHaveLength(1);
  });

  it('is one brief per day, not two, when he already asked for his day on Briefings', async () => {
    const asked = await publishPersonalBrief(ALEX, ACCOUNT, { now: new Date(MORNING.getTime() - 20 * 60_000), timeZone: TZ, writer: null });
    const out = await brief();

    const rows = await stored();

    expect(rows).toHaveLength(1);
    expect(out).toMatchObject({ delivered: true, briefingId: asked.id });
  });

  it('asking on Briefings past the Org\'s daily brief cap still gives a brief, with no model call', async () => {
    await db.update(tenantAccountSchema).set({ briefDailyCents: 0 }).where(eq(tenantAccountSchema.id, ACCOUNT));
    const spend = vi.fn(async () => null);

    const out = await publishPersonalBrief(ALEX, ACCOUNT, { now: MORNING, timeZone: TZ, writer: spend });

    expect(spend).not.toHaveBeenCalled();
    expect(out.budget).toMatchObject({ ok: false });
    expect(out.brief.markdown).toContain('Contoso Supply renewal quote');
  });

  it('still goes out when the writer cannot answer: the oldest decisions become the actions', async () => {
    const out = await deliverPersonalBrief({ userId: ALEX, accountId: ACCOUNT, kind: 'brief', day: '2026-10-09', timeZone: TZ, now: MORNING }, async () => null);

    const [ask] = await db.select().from(askSchema).where(and(eq(askSchema.orgId, home), eq(askSchema.conversationId, out.delivered ? out.conversationId : 0)));

    expect(ask!.options[0]).toMatchObject({ label: 'Take “Send the Contoso Supply renewal quote?”', recommended: true });
  });

  it('a brief with a connected calendar lists today\'s meetings with a line of context each', async () => {
    await storeLoginCredential({ orgId: home, platform: 'google', name: 'Google — alex', account: 'alex@northwind.example', values: { refreshToken: 'rt-alex', clientId: 'cid', clientSecret: 'cs', email: 'alex@northwind.example', scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose openid email' }, createdBy: ALEX });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }));
      }
      if (url.includes('/calendar/v3/')) {
        return new Response(JSON.stringify({ items: [{ id: 'ev1', summary: 'Renewal call', start: { dateTime: '2026-10-09T09:30:00-07:00' }, attendees: [{ email: 'alex@northwind.example' }, { email: 'dana@contoso.example' }] }] }));
      }
      if (url.includes('/gmail/v1/users/me/messages?')) {
        return new Response(JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }] }));
      }
      if (url.includes('/gmail/v1/users/me/messages/')) {
        return new Response(JSON.stringify({ id: 'm1', threadId: 't1', snippet: 'Could you send revised terms?', payload: { headers: [{ name: 'From', value: 'dana@contoso.example' }, { name: 'Subject', value: 'Renewal terms' }, { name: 'Date', value: 'Tue, 6 Oct 2026' }] } }));
      }
      return new Response('{}', { status: 404 });
    }));
    const seen: string[] = [];

    await deliverPersonalBrief({ userId: ALEX, accountId: ACCOUNT, kind: 'brief', day: '2026-10-09', timeZone: TZ, now: MORNING }, async (_org: string, facts: string) => {
      seen.push(facts);
      return { meetings: [{ id: 'ev1', context: 'Dana wants revised renewal terms (mail, Tue).' }], actions: [] };
    });

    const [row] = await stored();

    expect(row!.content).toContain('**9:30 AM PDT · Renewal call** — Dana wants revised renewal terms (mail, Tue).');
    // The writer read the mail evidence, gathered with Alex's own login.
    expect(seen[0]).toContain('Renewal terms — Could you send revised terms?');

    await db.delete((await import('@/models/Schema')).apiTokenSchema);
  });

  it('the wrap is a second kind of the same brief: done today, still open, first tomorrow', async () => {
    await db.update(askSchema).set({ status: 'approved', decidedBy: ALEX, decidedAt: new Date('2026-10-09T20:00:00Z') }).where(eq(askSchema.title, 'Which Bellwater Hall date holds?'));
    await db.insert(missionRunSchema).values({ orgId: REVENUE, title: 'Q4 pipeline review', brief: 'b', status: 'completed', team: { lead: 'lead', members: [] }, completedAt: new Date('2026-10-09T21:00:00Z') });

    const out = await deliverPersonalBrief({ userId: ALEX, accountId: ACCOUNT, kind: 'wrap', day: '2026-10-09', timeZone: TZ, now: new Date('2026-10-10T00:31:00Z') }, async () => null);

    expect(out).toMatchObject({ delivered: true, title: 'Your wrap — Fri, Oct 9, 2026' });

    const [row] = await stored();

    expect(row!.edition).toBe('wrap:2026-10-09');
    expect(row!.content).toContain('## Done today');
    expect(row!.content).toContain('You decided [Which Bellwater Hall date holds?]');
    expect(row!.content).toContain('Finished: Q4 pipeline review — Revenue Team');
    expect(row!.content).toContain('## Still open');
    expect(row!.content).toContain('## First tomorrow');
    expect(row!.content).toContain('Take [Send the Contoso Supply renewal quote?]');
  });

  it('the opening hint says the brief is ready until it is opened, and opens the stored brief', async () => {
    const out = await brief();

    const hints = await loadOpeningHints({ orgId: home, userId: ALEX, isAdmin: false, leadSpoken: 'your assistant', now: new Date(MORNING.getTime() + 60_000) });

    expect(hints[0]).toMatchObject({ label: 'Your morning brief is ready →', action: { kind: 'open', href: `/dashboard/briefings/${out.delivered ? out.briefingId : 0}` } });
  });
});
