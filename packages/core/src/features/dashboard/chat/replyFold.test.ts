/**
 * A long reply leads with its answer and folds the rest (Chris, 2026-09-29,
 * conversation 373: an eight-paragraph reply "too long to be useful and
 * respondable"). The reply below has that shape; every name is invented.
 */
import { describe, expect, it } from 'vitest';
import { FOLD_ABOVE_WORDS, foldReply } from './replyFold';

const P1 = '**[#41](/w/northwind/dashboard/p/feature/41) is waiting on you, not on the factory.** Plan 32 — match sends to opens, remind who has not opened — is written, correct, and sitting in review. Approve it and the contract can be written; leave it and the Friday date goes.';
const REST = [
  'What the plan commits to: `GET /v1/items/:id/sends` gains `openedAt`, `openCount` and a match value of opened, not opened or unknown, plus a remind endpoint and an auto-remind setting on the item. Three additive nullable columns, no backfill.',
  'Why it has not moved on its own: the last two planning runs both wrote to a pending review item rather than filing a plan record, so the factory logged that planning ended without a plan twice while plan 32 sat there, complete, the whole time.',
  'Two things to know before you approve. The plan changes a public interface, so approving it is approving the interface, not just the direction. And the main risk is handled: nothing rewrites the existing open-tracking rows.',
  'If you approve today, the contract gets written against the corrected paths and Friday is still reachable. If it slips past tomorrow, it is not.',
  'One caveat: #41 came from the design seat reading the product as it ships, not from a customer. Declining it is a reasonable call, and better now than after the contract is written.',
];
const LONG = [P1, ...REST].join('\n\n');

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('where a long reply folds', () => {
  it('shows the first paragraph as the lead and folds the other five', () => {
    const fold = foldReply(LONG)!;

    expect(fold.lead).toBe(P1);
    expect(fold.rest).toBe(REST.join('\n\n'));
    expect(fold.restWords).toBeGreaterThan(100);
  });

  it('loses nothing: the lead and the rest are the whole reply', () => {
    const fold = foldReply(LONG)!;

    expect(`${fold.lead}\n\n${fold.rest}`).toBe(LONG);
  });

  it('reads past a one-line preamble or a heading to a lead that answers', () => {
    const fold = foldReply(`## Where #41 stands\n\n${LONG}`)!;

    expect(fold.lead).toBe(`## Where #41 stands\n\n${P1}`);
  });

  it('cuts a first paragraph that runs on at the sentence that reaches ~80 words', () => {
    const one = [P1, ...REST].join(' ');
    const fold = foldReply(one)!;

    expect(words(fold.lead)).toBeGreaterThanOrEqual(70);
    expect(words(fold.lead)).toBeLessThan(130);
    expect(fold.lead).toMatch(/[.!?]\**$/);
    expect(`${fold.lead} ${fold.rest}`).toBe(one);
  });

  it('never cuts inside a code fence or a list', () => {
    const code = `Run this:\n\n\`\`\`sh\n${'echo step\n'.repeat(5)}\n\n${'echo more\n'.repeat(5)}\`\`\`\n\n${REST.join('\n\n')}`;
    const fold = foldReply(code)!;

    expect(fold.lead).toMatch(/^Run this:\n\n```sh[\s\S]*```$/);

    const list = `${Array.from({ length: 40 }, (_, n) => `- item ${n} with a few words on it`).join('\n')}\n\n${REST.join('\n\n')}`;

    expect(foldReply(list)!.lead.split('\n')).toHaveLength(40);
  });
});

describe('what is shown whole', () => {
  it('a reply at or under the threshold', () => {
    const short = [P1, REST[0]].join('\n\n');

    expect(words(short)).toBeLessThanOrEqual(FOLD_ABOVE_WORDS);
    expect(foldReply(short)).toBeNull();
  });

  it('a long lead with too little after it to be worth a tap', () => {
    const lead = 'This sentence has ten words in it for the test. '.repeat(13).trim();
    const tail = 'A short tail sentence. '.repeat(8).trim();

    expect(foldReply(`${lead}\n\n${tail}`)).toBeNull();
  });
});
