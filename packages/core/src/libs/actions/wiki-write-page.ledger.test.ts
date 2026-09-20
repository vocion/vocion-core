/**
 * One write action, one ledger per agent that asked for its own.
 *
 * `wiki.write_page` keys the autonomy ladder on itself unless the proposal
 * carries `by` — the agent whose `harness.ownLedger` names the kind — in
 * which case the rule, the rung and the evidence live under
 * `wiki.write_page.<agent>`. The wiki plugin holds the researcher's writes at
 * review this way while the curator keeps the shared 0.6 bar.
 */
import { describe, expect, it } from 'vitest';
import { actionForPolicyKey, policyKeyForRun } from './policyKey';
import { wikiWritePageAction } from './wiki-write-page';

const base = { slug: 'voice', title: 'Voice', md: 'Plain.', reason: 'a person said so' };

describe('wiki.write_page — the ledger key', () => {
  it('is the action id without `by`, and the agent\'s own ledger with it', () => {
    expect(policyKeyForRun('wiki.write_page', base)).toBe('wiki.write_page');
    expect(policyKeyForRun('wiki.write_page', { ...base, by: 'wiki-researcher' })).toBe('wiki.write_page.wiki-researcher');
  });

  it('a derived key still resolves to the registered action', () => {
    expect(actionForPolicyKey('wiki.write_page.wiki-researcher')?.id).toBe('wiki.write_page');
  });

  it('accepts `by` only as an agent slug', () => {
    expect(wikiWritePageAction.inputSchema.safeParse({ ...base, by: 'wiki-researcher' }).success).toBe(true);
    expect(wikiWritePageAction.inputSchema.safeParse({ ...base, by: 'Not A Slug' }).success).toBe(false);
    expect(wikiWritePageAction.inputSchema.safeParse(base).success).toBe(true);
  });
});
