import { describe, expect, it } from 'vitest';
import { cardLink, cardShown, describeActionEffect, describeCardState, readRecommendedAction } from './recommendedAction';

/**
 * On 2026-09-15 two `client.review.propose` calls 400'd with "Invalid input:
 * expected string, received undefined" — a card auto-firing at
 * `act-within-bounds` with no `actionId`. The server caught a call the client
 * should never have been able to make, so the check moved to the boundary the
 * payload arrives at.
 */
describe('readRecommendedAction', () => {
  it('accepts a complete recommendation and normalises what is missing', () => {
    const checked = readRecommendedAction({
      actionId: 'gmail.send',
      label: 'Send the follow-up',
      rationale: 'Owed since Tuesday',
      confidence: 0.82,
      agentSlug: 'revenue-lead',
    });

    expect(checked.ok).toBe(true);
    expect(checked.ok && checked.rec).toMatchObject({
      actionId: 'gmail.send',
      label: 'Send the follow-up',
      // An action with no arguments is legitimate; a mangled one is not.
      input: {},
      confidence: 0.82,
    });
  });

  it.each([
    [{ input: { to: 'x' }, label: 'Send it' }, /named no action/],
    [{ actionId: '   ', label: 'Send it' }, /named no action/],
    [{ actionId: 'gmail.send' }, /no label/],
    [{ actionId: 'gmail.send', label: '  ' }, /no label/],
    [undefined, /was missing/],
    [null, /was missing/],
    ['gmail.send', /was missing/],
    [[{ actionId: 'gmail.send' }], /was missing/],
  ])('refuses %j with a reason a person could read', (raw, reason) => {
    const checked = readRecommendedAction(raw);

    expect(checked.ok).toBe(false);
    expect(!checked.ok && checked.reason).toMatch(reason);
  });

  it('drops a non-object input rather than passing it through to the RPC', () => {
    const checked = readRecommendedAction({ actionId: 'gmail.send', label: 'Send it', input: 'to: someone' });

    expect(checked.ok && checked.rec.input).toEqual({});
  });

  it('keeps a server-filed runId and ignores a malformed one', () => {
    expect(readRecommendedAction({ actionId: 'a', label: 'b', runId: 7 })).toMatchObject({ rec: { runId: 7 } });
    expect(readRecommendedAction({ actionId: 'a', label: 'b', runId: '7' })).not.toMatchObject({ rec: { runId: 7 } });
  });

  it('keeps the agent\'s own recommendation, so the queue card carries what the agent said', () => {
    const checked = readRecommendedAction({
      actionId: 'gmail.send',
      label: 'Draft the note',
      suggestedDecision: 'snooze',
      suggestedDecisionReason: '  Worth doing, but not before the contract is signed.  ',
    });

    expect(checked).toMatchObject({
      rec: { suggestedDecision: 'snooze', suggestedDecisionReason: 'Worth doing, but not before the contract is signed.' },
    });
  });

  it.each([
    [{ suggestedDecision: 'approve' }, 'a verdict with no sentence a reviewer could check'],
    [{ suggestedDecisionReason: 'It is time.' }, 'a sentence arguing for an outcome the card never names'],
    [{ suggestedDecision: 'maybe', suggestedDecisionReason: 'It is time.' }, 'a verdict that is not one of the three'],
  ])('drops %j — %s', (advice: Record<string, string>, _why: string) => {
    // Half a recommendation is worse than none: the card would show an
    // argument with no verdict, or a verdict a reviewer cannot weigh.
    const checked = readRecommendedAction({ actionId: 'gmail.send', label: 'Draft the note', ...advice });

    expect(checked.ok).toBe(true);
    expect(checked.ok && checked.rec).not.toHaveProperty('suggestedDecision');
    expect(checked.ok && checked.rec).not.toHaveProperty('suggestedDecisionReason');
  });
});

describe('describeActionEffect', () => {
  it('says what approving does from the action id, not the agent\'s title', () => {
    expect(describeActionEffect('objects.propose_candidate')).toBe('Files a request on Work');
    expect(describeActionEffect('factory.dispatch_task')).toBe('Starts the build');
    expect(describeActionEffect('ask.file')).toBe('Asks you to rule');
    expect(describeActionEffect('git.merge')).toBe('Hands you the merge');
    expect(describeActionEffect('objects.update_meta')).toBe('Changes the record');
  });

  it('still says something readable for an id it has no words for', () => {
    expect(describeActionEffect('crm.log_call')).toBe('Runs crm: log call');
    expect(describeActionEffect('ping')).toBe('Runs ping');
    expect(describeActionEffect('  ')).toBe('Nothing to run: this is a note');
  });
});

describe('describeCardState', () => {
  const time = () => '7:50 AM';

  it('a ruling reads as its answer, and says when the trust bar chose it (proposal 5210)', () => {
    expect(describeCardState({ status: 'done', decidedBy: 'Dana Reyes', choice: { label: 'Show with upsell', byTrustBar: false } }, time)).toEqual({ label: 'You chose Show with upsell', tone: 'green' });
    expect(describeCardState({ status: 'done', approvedByAgent: true, choice: { label: 'Hide on locked rows', byTrustBar: true } }, time)).toEqual({ label: 'Chose Hide on locked rows for you', tone: 'green' });
  });

  it('names one state, never two at once', () => {
    expect(describeCardState({ status: null }, time).label).toBe('Waiting on you');
    // Meant to be filed and not: nothing is waiting on anyone (conversation 349).
    expect(describeCardState({ status: null, unfiled: true }, time)).toEqual({ label: 'Not filed', tone: 'red' });
    // A person filed it after all: the run's state wins.
    expect(describeCardState({ status: 'pending', unfiled: true }, time).label).toBe('Waiting on you');
    expect(describeCardState({ status: 'pending' }, time).label).toBe('Waiting on you');
    expect(describeCardState({ status: 'done', approvedByAgent: true, decidedBy: 'Dana Reyes' }, time).label).toBe('Done for you');
    expect(describeCardState({ status: 'done', decidedBy: 'Dana Reyes', decidedAt: '2026-09-28T14:50:00Z' }, time).label)
      .toBe('Approved by Dana Reyes · 7:50 AM');
    expect(describeCardState({ status: 'rejected', decidedBy: 'Dana Reyes' }, time).label).toBe('Rejected by Dana Reyes');
    expect(describeCardState({ status: 'rejected' }, time).label).toBe('Rejected');
    expect(describeCardState({ status: 'executing', approvedByAgent: true }, time).label).toBe('Done for you · running');
    expect(describeCardState({ status: 'snoozed' }, time).label).toBe('Deferred');
  });

  it('a done card says what was done, from the run (Chris, 2026-09-28: "Done for you · Undo" did not say it ran)', () => {
    expect(describeCardState({ status: 'done', approvedByAgent: true, summary: 'changed request #124: outcome, mainRisk' }, time))
      .toEqual({ label: 'Done for you — changed request #124: outcome, mainRisk', tone: 'green' });
    expect(describeCardState({ status: 'done', decidedBy: 'Dana Reyes', summary: 'filed request #131' }, time).label).toBe('Approved by Dana Reyes — filed request #131');
    // Only a done run says what it did; a waiting one does not claim it.
    expect(describeCardState({ status: 'pending', summary: 'changed request #124: outcome' }, time).label).toBe('Waiting on you');
  });

  it('a filing that misses its bar reads "Draft needed" until a run exists', () => {
    expect(describeCardState({ status: null, draft: true }, time)).toEqual({ label: 'Draft needed', tone: 'amber' });
    expect(describeCardState({ status: 'pending', draft: true }, time).label).toBe('Waiting on you');
  });
});

describe('a "Draft needed" card at the boundary', () => {
  it('keeps its prompt and what was missing, and drops a draft with no prompt', () => {
    const rec = { actionId: 'objects.propose_candidate', label: 'File in-app notifications', input: { objectType: 'request' } };

    expect(readRecommendedAction({ ...rec, draft: { prompt: 'Draft the full request "In-app notifications".', missing: 'story; acceptance' } })).toMatchObject({ ok: true, rec: { draft: { prompt: 'Draft the full request "In-app notifications".', missing: 'story; acceptance' } } });
    expect(readRecommendedAction({ ...rec, draft: { missing: 'story' } })).toMatchObject({ ok: true, rec: expect.not.objectContaining({ draft: expect.anything() }) });
  });
});

describe('a card\'s record link (2026-09-28: "click through to the feature detail page")', () => {
  it('keeps a link inside the app and drops one that leaves it', () => {
    expect(cardLink('/w/kestrel/dashboard/p/feature/201', 'Open feature')).toEqual({ href: '/w/kestrel/dashboard/p/feature/201', hrefLabel: 'Open feature' });
    expect(cardLink('https://evil.example/x', 'Open')).toEqual({});
    expect(cardLink('//evil.example/x', 'Open')).toEqual({});
    expect(cardLink('javascript:alert(1)', 'Open')).toEqual({});
  });

  it('rides the recommendation through the event boundary', () => {
    const checked = readRecommendedAction({ actionId: 'factory.dispatch_task', label: 'Approve build', input: { requestId: 201 }, href: '/w/kestrel/dashboard/p/feature/201', hrefLabel: 'Open feature' });

    expect(checked.ok && checked.rec).toMatchObject({ href: '/w/kestrel/dashboard/p/feature/201', hrefLabel: 'Open feature' });
  });
});

/**
 * A card's links are agent output. Every one must stay inside the product:
 * `/\evil.example` reads as `//evil.example` in a browser, and a control
 * character can hide the real target from a person reading the link.
 */
describe('in-app links on a card', () => {
  it.each(['/\\evil.example', '//evil.example', 'https://evil.example', 'javascript:alert(1)', '/ok\u0000x'])('cardLink drops %j', (href) => {
    expect(cardLink(href, 'Open')).toEqual({});
  });

  it('cardLink keeps an app path with its label', () => {
    expect(cardLink('/dashboard/connectors?add=github', 'Connect')).toEqual({ href: '/dashboard/connectors?add=github', hrefLabel: 'Connect' });
  });

  it('cardShown drops a bad secondary link and keeps a good one with its label', () => {
    expect(cardShown({ secondaryHref: '/\\evil.example', secondaryHrefLabel: 'Paste a token' })).toEqual({});
    expect(cardShown({ secondaryHref: '/dashboard/connectors?paste=1', secondaryHrefLabel: 'Paste a token' })).toEqual({ secondaryHref: '/dashboard/connectors?paste=1', secondaryHrefLabel: 'Paste a token' });
  });

  it('cardShown drops a bad field link but keeps the field', () => {
    const shown = cardShown({ fields: [{ label: 'Repo', value: 'northwind/portal', href: 'https://evil.example' }, { label: 'Page', value: 'Connectors', href: '/dashboard/connectors' }, { label: 'Account', value: 'northwind' }] });

    expect(shown.fields).toEqual([{ label: 'Repo', value: 'northwind/portal' }, { label: 'Page', value: 'Connectors', href: '/dashboard/connectors' }, { label: 'Account', value: 'northwind' }]);
  });

  it('cardShown keeps a field whose stored link is null, and drops a non-text link', () => {
    const shown = cardShown({ fields: [{ label: 'Repo', value: 'northwind/portal', href: null }, { label: 'Page', value: 'Connectors', href: 42 }] } as never);

    expect(shown.fields).toEqual([{ label: 'Repo', value: 'northwind/portal' }, { label: 'Page', value: 'Connectors' }]);
  });

  it('cardShown leaves keys that were not set absent', () => {
    expect(cardShown({})).toEqual({});
  });
});
