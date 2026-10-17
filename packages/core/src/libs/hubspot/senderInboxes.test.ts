import { describe, expect, it } from 'vitest';
import { capFor, dayBounds, localDay, pickInbox, senderConfigOf, senderConfigSchema } from './senderInboxes';

const cfg = senderConfigSchema.parse({
  user: 'rep@northwind.example',
  timezone: 'America/Los_Angeles',
  inboxes: [
    { email: 'rep@northwind.example' },
    { email: 'rep@northwind-mail.example', hubspotUser: 'ops@northwind.example', warmup: { start: '2026-10-19', perDay: [5, 10, 20, 30] } },
    { email: 'rep@meet-northwind.example', hubspotUser: 'ops@northwind.example', warmup: { start: '2026-10-19', perDay: [5, 10, 20, 30] } },
  ],
});

describe('the ramp', () => {
  const warm = cfg.inboxes[1]!;

  it('steps by week from the start day and holds the last value after', () => {
    expect(capFor(warm, '2026-10-19')).toEqual({ cap: 5, week: 1 });
    expect(capFor(warm, '2026-10-25')).toEqual({ cap: 5, week: 1 });
    expect(capFor(warm, '2026-10-26')).toEqual({ cap: 10, week: 2 });
    expect(capFor(warm, '2026-11-09')).toEqual({ cap: 30, week: 4 });
    expect(capFor(warm, '2027-01-04')).toEqual({ cap: 30, week: 12 });
  });

  it('takes nothing before it starts', () => {
    expect(capFor(warm, '2026-10-18')).toEqual({ cap: 0, week: 0 });
  });

  it('leaves an inbox with no ramp and no cap uncapped, and lets a flat cap lower a ramp', () => {
    expect(capFor(cfg.inboxes[0]!, '2026-10-19')).toBeNull();
    expect(capFor({ ...warm, dailyCap: 3 }, '2026-11-09')).toEqual({ cap: 3, week: 4 });
  });
});

describe('the day the cap counts in', () => {
  it('is the sender\'s calendar day, not UTC\'s', () => {
    // 05:00 UTC on the 20th is still the 19th in Los Angeles.
    expect(localDay(new Date('2026-10-20T05:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-19');
  });

  it('starts and ends at local midnight, across a DST change too', () => {
    expect(dayBounds('2026-10-19', 'America/Los_Angeles')).toEqual({ start: new Date('2026-10-19T07:00:00Z'), end: new Date('2026-10-20T07:00:00Z') });
    // 2026-11-01 is 25 hours long in Los Angeles.
    expect(dayBounds('2026-11-01', 'America/Los_Angeles')).toEqual({ start: new Date('2026-11-01T07:00:00Z'), end: new Date('2026-11-02T08:00:00Z') });
  });
});

describe('picking the inbox', () => {
  const day = '2026-10-19';

  it('fills the warm-up inbox with the most room first, as the user it is connected under', () => {
    const pick = pickInbox(cfg, { day, counts: { 'rep@northwind-mail.example': 3, 'rep@meet-northwind.example': 1 } });

    expect(pick).toMatchObject({ ok: true, inbox: { email: 'rep@meet-northwind.example' }, hubspotUser: 'ops@northwind.example', reason: 'warmup', usedToday: 1, capToday: 5, week: 1 });
  });

  it('overflows to the established inbox once every ramp is spent for the day', () => {
    const pick = pickInbox(cfg, { day, counts: { 'rep@northwind-mail.example': 5, 'rep@meet-northwind.example': 5 } });

    expect(pick).toMatchObject({ ok: true, inbox: { email: 'rep@northwind.example' }, hubspotUser: 'rep@northwind.example', reason: 'established', capToday: null });
  });

  it('keeps a contact on the inbox it heard from while that inbox has room', () => {
    expect(pickInbox(cfg, { day, counts: {}, previousInbox: 'REP@northwind.example' })).toMatchObject({ reason: 'continuity', inbox: { email: 'rep@northwind.example' } });
    expect(pickInbox(cfg, { day, counts: { 'rep@meet-northwind.example': 5 }, previousInbox: 'rep@meet-northwind.example' })).toMatchObject({ reason: 'warmup', inbox: { email: 'rep@northwind-mail.example' } });
  });

  it('skips a paused inbox, and refuses with every inbox\'s standing when nothing has room', () => {
    const tight = senderConfigSchema.parse({
      user: 'rep@northwind.example',
      inboxes: [
        { email: 'rep@northwind.example', dailyCap: 2 },
        { email: 'rep@northwind-mail.example', warmup: { start: '2026-10-19', perDay: [5] }, paused: true },
      ],
    });

    expect(pickInbox(tight, { day, counts: { 'rep@northwind.example': 2 } })).toEqual({
      ok: false,
      message: 'Today\'s sending budget is used: rep@northwind.example 2 of 2, rep@northwind-mail.example paused. Enroll again tomorrow.',
    });
  });
});

describe('reading the config', () => {
  it('reads a bare defaultSender as one user on their own inbox', () => {
    expect(senderConfigOf({ defaultSender: 'rep@northwind.example' })).toMatchObject({ user: 'rep@northwind.example', inboxes: [{ email: 'rep@northwind.example', paused: false }] });
  });

  it('prefers sender over defaultSender, and is null when neither is set', () => {
    expect(senderConfigOf({ sender: { user: 'a@northwind.example', inboxes: [{ email: 'a@northwind.example' }] }, defaultSender: 'b@northwind.example' })?.user).toBe('a@northwind.example');
    expect(senderConfigOf({})).toBeNull();
  });

  it('says what is wrong with a malformed sender rather than enrolling as someone', () => {
    expect(() => senderConfigOf({ sender: { user: 'not-an-email', inboxes: [] } })).toThrow(/sender config is invalid/);
  });
});
