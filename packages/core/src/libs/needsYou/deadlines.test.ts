import type { DefaultFacts } from './deadlines';
import { describe, expect, it } from 'vitest';
import { batchKeyFor, clockFor, deadlineDistance, defaultVerdict, MIN_NOTICE_MS, riskTierOf } from './deadlines';

const H = 60 * 60_000;
const NOW = new Date('2026-10-08T12:00:00.000Z');

describe('clockFor', () => {
  it('gives a fresh decision its window by risk, and tells the owner a quarter of it before', () => {
    const low = clockFor({ createdAt: NOW, risk: 'low', now: NOW });

    expect(low.deadlineAt.getTime() - NOW.getTime()).toBe(24 * H);
    expect(low.deadlineAt.getTime() - low.escalateAt.getTime()).toBe(6 * H);

    const high = clockFor({ createdAt: NOW, risk: 'high', now: NOW });

    expect(high.deadlineAt.getTime() - NOW.getTime()).toBe(168 * H);
    expect(high.deadlineAt.getTime() - high.escalateAt.getTime()).toBe(42 * H);
  });

  it('never defaults a backlog on sight: a decision older than its window gets a full notice from now, escalated first', () => {
    const fiftyThreeDaysAgo = new Date(NOW.getTime() - 53 * 24 * H);
    const c = clockFor({ createdAt: fiftyThreeDaysAgo, risk: 'medium', now: NOW });

    expect(c.escalateAt.getTime()).toBe(NOW.getTime());
    expect(c.deadlineAt.getTime() - NOW.getTime()).toBe(18 * H);
  });

  it('honours the asker\'s own due date, never earlier than an hour from now', () => {
    const due = new Date(NOW.getTime() + 3 * 24 * H);

    expect(clockFor({ createdAt: NOW, dueAt: due, risk: 'low', now: NOW }).deadlineAt).toEqual(due);

    const soon = clockFor({ createdAt: NOW, dueAt: new Date(NOW.getTime() + 10 * 60_000), risk: 'low', now: NOW });

    expect(soon.deadlineAt.getTime() - NOW.getTime()).toBe(MIN_NOTICE_MS);
    expect(soon.escalateAt.getTime()).toBe(NOW.getTime());
  });

  it('reads an unknown risk as low', () => {
    expect(riskTierOf(null)).toBe('low');
    expect(riskTierOf('extreme')).toBe('low');
    expect(riskTierOf('high')).toBe('high');
  });
});

const BASE: DefaultFacts = {
  defaultOption: 'approve',
  inert: false,
  neverAuto: false,
  heldForPerson: null,
  rung: 'execute-with-approval',
  riskTier: 'low',
  reversible: true,
  undone: false,
  escalations: 1,
};

describe('defaultVerdict', () => {
  it('applies a reversible, low-risk default with Undo', () => {
    expect(defaultVerdict(BASE)).toMatchObject({ mode: 'apply', basis: 'reversible' });
  });

  it('applies whatever the ladder already lets run without a person, reversible or not', () => {
    expect(defaultVerdict({ ...BASE, rung: 'execute-within-bounds', reversible: false, riskTier: 'high' })).toMatchObject({ mode: 'apply', basis: 'ladder' });
  });

  it('applies a default that runs nothing', () => {
    expect(defaultVerdict({ ...BASE, inert: true, reversible: false, riskTier: 'high' })).toMatchObject({ mode: 'apply', basis: 'inert' });
  });

  it.each([
    ['no default was declared', { defaultOption: null }, /no recommended answer/],
    ['nobody was told', { escalations: 0 }, /nobody has been told/],
    ['a person undid the default', { undone: true }, /took the default back/],
    ['the platform holds the kind', { neverAuto: true }, /held at approval by the platform/],
    ['the record holds itself', { heldForPerson: 'the request is locked by its owner' }, /locked by its owner/],
    ['a person parked the kind', { rung: 'assist' as const }, /parked at assist/],
    ['it cannot be undone', { reversible: false }, /cannot be undone/],
    ['it is high-risk', { riskTier: 'high' as const }, /high-risk/],
  ])('holds when %s — and never runs what the ladder keeps', (_why, patch, reason) => {
    const verdict = defaultVerdict({ ...BASE, ...patch });

    expect(verdict.mode).toBe('hold');
    expect(verdict.basis).toBeNull();
    expect(verdict.reason).toMatch(reason);
  });

  it('holds a never-auto kind even when its rung would automate', () => {
    expect(defaultVerdict({ ...BASE, neverAuto: true, rung: 'autonomous' }).mode).toBe('hold');
  });
});

describe('batchKeyFor / deadlineDistance', () => {
  it('gathers recommendations that read the same, whatever their case or spacing', () => {
    expect(batchKeyFor(' Approve ')).toBe(batchKeyFor('approve'));
    expect(batchKeyFor('Ship  it')).toBe('ship it');
    expect(batchKeyFor('Approve')).not.toBe(batchKeyFor('Decline'));
  });

  it('says how far a deadline is, either side of now', () => {
    expect(deadlineDistance(new Date(NOW.getTime() + 5 * H), NOW)).toBe('in 5h');
    expect(deadlineDistance(new Date(NOW.getTime() + 3 * 24 * H), NOW)).toBe('in 3d');
    expect(deadlineDistance(new Date(NOW.getTime() - 20 * 60_000), NOW)).toBe('20m ago');
  });
});
