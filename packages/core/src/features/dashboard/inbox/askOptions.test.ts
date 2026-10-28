import type { AnswerListeners } from './askOptions';
import { describe, expect, it } from 'vitest';
import { consequenceOf, FIXED_ROWS, fixedRowsFor, labelFor, OTHER } from './askOptions';

describe('labelFor', () => {
  it('names the ask\'s own option', () => {
    const ask = { options: [{ id: 'a-github-action-family', label: 'Add github.* family', description: '' }] };

    expect(labelFor(ask, 'a-github-action-family')).toBe('Add github.* family');
  });

  it('falls back to the fixed rows when the ask names no options', () => {
    expect(labelFor({ options: [] }, 'approve')).toBe('Approve');
    expect(labelFor({ options: [] }, 'reject')).toBe('Reject');
    expect(labelFor({ options: [] }, 'done')).toBe('Mark done');
  });

  it('labels a free-text answer', () => {
    expect(labelFor({ options: [] }, OTHER)).toBe('Other');
  });

  it('returns the raw id rather than nothing when the option is gone', () => {
    expect(labelFor({ options: [] }, 'retired-option')).toBe('retired-option');
  });

  it('is importable from a server module — no client-only dependency', () => {
    // The whole point of this module: it must not pull in 'use client' code.
    // A regression here shows up as "Attempted to call labelFor() from the
    // server" in production, not as a failure at build time.
    expect(FIXED_ROWS).toHaveLength(3);
  });
});

describe('what an answer does (ruling #145, 2026-09-29)', () => {
  it('never says "as proposed": an ask with no options proposes nothing', () => {
    const cases: Array<AnswerListeners | undefined> = [undefined, {}, { approve: ['Page the on-call engineer'] }];
    for (const listeners of cases) {
      for (const row of fixedRowsFor({ agentSlug: null }, listeners)) {
        expect(row.description).not.toMatch(/as proposed/i);
      }
    }
  });

  it('names what an answer starts, from the subscribers it matches', () => {
    expect(consequenceOf({ agentSlug: 'incident-lead' }, 'approve', { approve: ['Page the on-call engineer', 'Open an incident'] }))
      .toBe('Starts “Page the on-call engineer” and “Open an incident”.');
  });

  it('says nothing runs only when the page looked and found nothing', () => {
    expect(consequenceOf({ agentSlug: 'incident-lead' }, 'approve', { approve: [] }))
      .toBe('Your answer is recorded for incident-lead; nothing runs on its own.');
    expect(consequenceOf({ agentSlug: null }, 'reject', {}))
      .toBe('Your answer is recorded for whoever asked.');
    expect(consequenceOf({ agentSlug: null }, 'reject', undefined))
      .toBe('Your answer is recorded for whoever asked.');
  });
});

describe('an ask that says what its answer does', () => {
  const ask = { agentSlug: 'seo-strategist', outcomes: { onApprove: 'The briefs start.', onRevise: 'It re-plans with your note.' } };

  it('says the asker\'s line in place of "nothing runs on its own"', () => {
    expect(consequenceOf(ask, 'approve', { approve: [] })).toBe('The briefs start.');
    expect(consequenceOf(ask, 'other', { other: [] })).toBe('It re-plans with your note.');
    expect(fixedRowsFor(ask, {})[0]!.description).toBe('Yes. The briefs start.');
  });

  it('an answer it says nothing about reads as before', () => {
    expect(consequenceOf(ask, 'reject', { reject: [] })).toBe('Your answer is recorded for seo-strategist; nothing runs on its own.');
    expect(consequenceOf({ agentSlug: 'seo-strategist', outcomes: null }, 'approve', { approve: [] })).toBe('Your answer is recorded for seo-strategist; nothing runs on its own.');
  });
});
