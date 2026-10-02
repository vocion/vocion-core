/**
 * A TURN ON A RECORD'S PAGE (conversation 362, 2026-09-29).
 *
 * On request #227's page the person wrote "Three changes to this request:
 * 1) … 2) … 3) add an acceptance line …". The router sent it to
 * change-reviewer on the word "changes"; change-reviewer read the record and
 * answered "two edits written to the record"; nothing was written, because
 * the owed-change pass read the message as no change at all, and the claim
 * check did not know an edit claim when it saw one.
 */
import type { RoutableAgent } from './router';
import { describe, expect, it } from 'vitest';
import { chooseAgent, pageOwnerDecision } from './router';

const pm: RoutableAgent = { slug: 'product-manager', name: 'Product manager', description: 'Owns requests from filing to release.', initiative: 'high' };
const reviewer: RoutableAgent = { slug: 'change-reviewer', name: 'Change reviewer', description: 'Reviews changes against the acceptance contract.', suggestions: [{ label: 'Review changes', prompt: 'Review the changes' }] };
const roster = [pm, reviewer];
const MESSAGE = 'Three changes to this request: 1) the reminder goes to the sender, not the viewer; 2) it names who has not opened yet; 3) add an acceptance line that a sender can turn reminders off per document.';

describe('who answers on a record\'s page', () => {
  it('the keyword router alone sends "changes" to the reviewer — the specimen', () => {
    expect(chooseAgent({ agents: roster, message: MESSAGE, surface: 'chat' })?.chosen).toBe('change-reviewer');
  });

  it('on the page, the type\'s owner answers, and the reason names the page', () => {
    const decision = pageOwnerDecision({ agents: roster, message: MESSAGE, record: { objectType: 'request', id: '227' }, ownerSlug: 'product-manager', surface: 'chat' });

    expect(decision?.chosen).toBe('product-manager');
    expect(decision?.reason).toBe('The page is request #227, and product-manager answers for requests on their page.');
  });

  it('an agent the person names still wins', () => {
    expect(pageOwnerDecision({ agents: roster, message: `@change-reviewer ${MESSAGE}`, record: { objectType: 'request', id: '227' }, ownerSlug: 'product-manager', surface: 'chat' })?.chosen).toBe('change-reviewer');
  });

  it('no record, no owner, or an owner not here: the router decides', () => {
    expect(pageOwnerDecision({ agents: roster, message: MESSAGE, record: null, ownerSlug: 'product-manager', surface: 'chat' })).toBeNull();
    expect(pageOwnerDecision({ agents: roster, message: MESSAGE, record: { objectType: 'request', id: '227' }, ownerSlug: null, surface: 'chat' })).toBeNull();
    expect(pageOwnerDecision({ agents: [reviewer], message: MESSAGE, record: { objectType: 'request', id: '227' }, ownerSlug: 'product-manager', surface: 'chat' })).toBeNull();
  });
});
