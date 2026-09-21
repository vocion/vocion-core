import type { Touch } from './reviewContextModel';
import { describe, expect, it } from 'vitest';
import { buildReviewContext, contactEmailOf } from './reviewContextModel';

const NOW = new Date('2026-09-18T16:00:00Z');
const contact = { status: 'ok' as const, data: { hubspotId: '77', name: 'Amy Larkin', email: 'amy@northwind.example', company: 'Northwind', jobTitle: 'VP People', lifecycleStage: 'lead', owner: null, createdAt: '2026-09-01T00:00:00Z', source: 'Offline — import', sourceDetail: null, href: null } };
const touch = (over: Partial<Touch>): Touch => ({ direction: 'in', subject: 'Re: timing', snippet: '…', at: '2026-09-10T12:00:00Z', source: 'hubspot', href: null, ...over });

describe('buildReviewContext', () => {
  it('merges CRM and mailbox touches newest first, and folds the same message logged twice into one', () => {
    const ctx = buildReviewContext({
      email: 'amy@northwind.example',
      contact,
      hubspotTouches: { status: 'ok', data: [touch({ at: '2026-09-10T12:00:00Z' })] },
      mirrorTouches: { status: 'ok', data: [touch({ at: '2026-09-10T12:05:00Z', source: 'gmail' }), touch({ subject: 'Proposal', direction: 'out', at: '2026-09-16T09:00:00Z', source: 'gmail' })] },
      enrollment: { status: 'ok', data: { enrolled: false, sequenceName: null, enrolledBy: null } },
      now: NOW,
    });

    expect(ctx.touches.status).toBe('ok');
    expect(ctx.touches.status === 'ok' && ctx.touches.data.map(t => t.subject)).toEqual(['Proposal', 'Re: timing']);
  });

  it('warns about a double send: a live sequence, or an outbound in the last week', () => {
    const ctx = buildReviewContext({
      email: 'amy@northwind.example',
      contact,
      hubspotTouches: { status: 'ok', data: [touch({ direction: 'out', subject: 'Following up', at: '2026-09-17T09:00:00Z' })] },
      mirrorTouches: { status: 'not-connected' },
      enrollment: { status: 'ok', data: { enrolled: true, sequenceName: 'Reconnect Q3', enrolledBy: 'chris@metacto.example' } },
      now: NOW,
    });

    expect(ctx.warnings).toHaveLength(2);
    expect(ctx.warnings[0]).toContain('Reconnect Q3');
    expect(ctx.warnings[1]).toContain('yesterday');
    expect(ctx.warnings[1]).toContain('Following up');
  });

  it('says not connected only when NO system could be read, none when they read and found nothing, and keeps a read error\'s own words', () => {
    const base = { email: 'amy@northwind.example', contact, enrollment: { status: 'not-connected' as const }, now: NOW };

    expect(buildReviewContext({ ...base, hubspotTouches: { status: 'not-connected' }, mirrorTouches: { status: 'not-connected' } }).touches).toEqual({ status: 'not-connected' });
    expect(buildReviewContext({ ...base, hubspotTouches: { status: 'not-connected' }, mirrorTouches: { status: 'none' } }).touches).toEqual({ status: 'none' });
    expect(buildReviewContext({ ...base, hubspotTouches: { status: 'error', message: 'missing_scope: sales-email-read' }, mirrorTouches: { status: 'none' } }).touches).toEqual({ status: 'error', message: 'missing_scope: sales-email-read' });
    expect(buildReviewContext({ ...base, hubspotTouches: { status: 'none' }, mirrorTouches: { status: 'none' } }).warnings).toEqual([]);
  });
});

describe('contactEmailOf', () => {
  it('reads the recipient off an email proposal, even with a display name', () => {
    expect(contactEmailOf({ actionId: 'gmail.send', input: { to: '"Amy Larkin" <Amy@Northwind.example>' }, recordKey: null })).toBe('amy@northwind.example');
  });

  it('reads the record key for anything else about an address, and is null for a deal', () => {
    expect(contactEmailOf({ actionId: 'hubspot.update', input: {}, recordKey: 'email:jordan@northwind.example' })).toBe('jordan@northwind.example');
    expect(contactEmailOf({ actionId: 'hubspot.update', input: { objectType: 'deals' }, recordKey: 'hubspot:deals:900112' })).toBeNull();
  });
});
