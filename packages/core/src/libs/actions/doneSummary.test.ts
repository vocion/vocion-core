import { describe, expect, it } from 'vitest';
import { doneSummary, undoneSummary } from './doneSummary';

describe('what a done run did, in one clause (Chris, 2026-09-28: "Done for you · Undo" did not say what ran)', () => {
  it('a change names the record and the fields it wrote, from the run\'s result', () => {
    // Run 4949's shape: objects.update_meta on request 124, outcome and mainRisk written.
    expect(doneSummary({ actionId: 'objects.update_meta', input: { objectType: 'request', id: 124, set: { outcome: 'Email only.', mainRisk: 'Core read model.' } }, result: { set: { outcome: 'Email only.', mainRisk: 'Core read model.' }, runId: 4949, title: 'Open alerts' } }))
      .toBe('changed request #124: outcome, mainRisk');
    expect(doneSummary({ actionId: 'objects.update_meta', input: { objectType: 'engineering_task', id: '9', set: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } }, result: null }))
      .toBe('changed engineering task #9: a, b, c, d +2 more');
  });

  it('a filing names the record it made; a build names the request it builds', () => {
    expect(doneSummary({ actionId: 'objects.propose_candidate', input: { objectType: 'request' }, result: { objectId: 131 } }, { type: 'request', id: 131 })).toBe('filed request #131');
    expect(doneSummary({ actionId: 'factory.dispatch_task', input: { requestId: 124 }, result: {} })).toBe('started the build of feature #124');
    expect(doneSummary({ actionId: 'objects.rename', input: { id: 40, title: 'Rename Send to Stamp' }, result: {} })).toBe('renamed #40 to "Rename Send to Stamp"');
  });

  it('a dispatch says what it started, and a dispatch that re-planned says so (action run 5201, 2026-09-29)', () => {
    // 5201's shape: the plan no longer fit, so the request went back to planning and nothing was built.
    expect(doneSummary({ actionId: 'factory.dispatch_task', input: { taskId: 203, planId: 215 }, result: { planning: true, requestId: 201, planId: null, workerRunId: null } }))
      .toBe('sent feature #201 back to planning');
    expect(doneSummary({ actionId: 'factory.dispatch_task', input: { taskId: 203 }, result: { workerRunId: 355, requestId: 201, taskId: 203 } }))
      .toBe('started the build of feature #201 — run #355');
  });

  it('a ruling says which option it was answered with, and who chose it (proposal 5210, 2026-09-29)', () => {
    expect(doneSummary({ actionId: 'ask.file', input: { kind: 'ruling' }, result: { askId: 9, answered: 'hide', answeredLabel: 'Hide on locked rows', answeredBy: 'trust-ladder' } }))
      .toBe('chose "Hide on locked rows" for you');
    expect(doneSummary({ actionId: 'ask.file', input: { kind: 'ruling' }, result: { askId: 9, answered: 'upsell', answeredLabel: 'Show with upsell', answeredBy: 'usr-dana' } }))
      .toBe('chose "Show with upsell"');
    expect(doneSummary({ actionId: 'ask.file', input: {}, result: { askId: 9, answered: null } })).toBeNull();
  });

  it('says nothing it cannot back: no record, no clause', () => {
    expect(doneSummary({ actionId: 'objects.update_meta', input: { set: { outcome: 'x' } }, result: {} })).toBeNull();
    expect(doneSummary({ actionId: 'gmail.send', input: { to: 'a@northwind.example' }, result: {} })).toBeNull();
    // `refOf` falls back to the action id as a "type"; that is not a record.
    expect(doneSummary({ actionId: 'ask.file', input: {}, result: { id: 3 } }, { type: 'ask.file', id: 3 })).toBeNull();
  });
});

describe('what a source connect did and what its Undo took back (#1080)', () => {
  it('a saved source says its sync started, or that it did not and what to press', () => {
    expect(doneSummary({ actionId: 'source.connect', input: {}, result: { created: true, firstSync: 'started' } })).toBe('saved the source and started its sync');
    expect(doneSummary({ actionId: 'source.connect', input: {}, result: { created: false, firstSync: 'failed' } })).toBe('added the pick to the source; its sync could not start, so press Sync now on Connectors');
  });

  it('Undo of a new source says its documents went with it; Undo of a pick says the old picks are back', () => {
    expect(undoneSummary({ actionId: 'source.connect', result: { created: true } })).toBe('removed the source and the documents it had read');
    expect(undoneSummary({ actionId: 'source.connect', result: { created: false } })).toBe('put the source\'s earlier picks back and started a fresh sync');
  });

  it('says nothing more for other kinds, whose Undone is enough', () => {
    expect(undoneSummary({ actionId: 'gmail.send', result: {} })).toBeNull();
  });
});
