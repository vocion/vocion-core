import { describe, expect, it } from 'vitest';
import { findRecordMentions, linkRecordMentions } from './recordMentions';

const WORDS = ['request', 'feature', 'engineering task'];

describe('record mentions in an answer (Chris, 2026-09-28: "click through to the feature detail page")', () => {
  it('finds "#201", "request 201", "request #201" and "feature 44"', () => {
    const found = findRecordMentions('File it next to #201. Request 202 is close, request #203 too, and feature 44 shipped.', WORDS);

    expect(found).toEqual([
      { text: '#201', id: 201, word: null },
      { text: 'Request 202', id: 202, word: 'request' },
      { text: 'request #203', id: 203, word: 'request' },
      { text: 'feature 44', id: 44, word: 'feature' },
    ]);
  });

  it('leaves other numbering alone: a PR, a run, a rank, code and links', () => {
    const found = findRecordMentions('PR #844 merged; run #355 passed; the #1 thing; `#201`; [#202](/x); https://h.example/#203; proposal #3722.', WORDS);

    expect(found).toEqual([]);
  });

  it('links each mention to its page, outside code and existing links, and is idempotent', () => {
    const links = [{ text: '#201', href: '/w/kestrel/dashboard/p/feature/201' }, { text: 'request 202', href: '/w/kestrel/dashboard/p/feature/202' }];
    const once = linkRecordMentions('See #201 and Request 202. Not `#201`, not [#201](/x).', links);

    expect(once).toBe('See [#201](/w/kestrel/dashboard/p/feature/201) and [Request 202](/w/kestrel/dashboard/p/feature/202). Not `#201`, not [#201](/x).');
    expect(linkRecordMentions(once, links)).toBe(once);
  });

  it('does not link a longer number that starts with the same digits', () => {
    expect(linkRecordMentions('#2010 is not #201.', [{ text: '#201', href: '/p/201' }])).toBe('#2010 is not [#201](/p/201).');
  });
});
