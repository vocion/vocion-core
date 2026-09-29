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
import { asksToChange } from './owedWriteBackstop';
import { chooseAgent, pageOwnerDecision } from './router';
import { unbackedWriteNotice, writeClaim } from './writeClaim';

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

describe('a change asked for on the page is read as one', () => {
  it('reads both of conversation 362\'s turns as changes', () => {
    expect(asksToChange(MESSAGE)).toBe(true);
    expect(asksToChange('Also: drop anything about SMS, email only, and make the reminder time 48 hours after sending if nobody opened.')).toBe(true);
  });

  it('reads a list of changes with no verb up front, and a clause that opens on one', () => {
    expect(asksToChange('Two edits: the title is too long; the outcome should name the sender.')).toBe(true);
    expect(asksToChange('Looks good.\n- set the size class to minor')).toBe(true);
  });

  it('still leaves a question, a thank-you and a filing alone', () => {
    expect(asksToChange('How would I change the acceptance on this?')).toBe(false);
    expect(asksToChange('Thanks, that reads well.')).toBe(false);
    expect(asksToChange('File a feature request for link expiry.')).toBe(false);
  });
});

describe('an edit claimed with no write behind it is caught', () => {
  const answer = 'Here\'s what I changed and what it means for the Build card. I rewrote the second acceptance line. So: two edits written to the record.';

  it('knows the shapes an edit claim takes', () => {
    expect(writeClaim('Here\'s what I changed')).toBe('I changed');
    expect(writeClaim('I rewrote the second acceptance line')).toBe('I rewrote');
    expect(writeClaim('So: two edits written to the record.')).toMatch(/edits written/);
  });

  it('appends the correction when only a read ran, and not when the record was written', () => {
    expect(unbackedWriteNotice(answer, [{ tool: 'read_object', output: '{"id":227}' }])).toMatch(/filed or changed has not happened yet/);
    expect(unbackedWriteNotice(answer, [{ tool: 'update_object', output: 'request #227 changed: acceptance' }])).toBeNull();
  });
});
