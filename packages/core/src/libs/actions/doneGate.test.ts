import { describe, expect, it } from 'vitest';
import { doneRefusal } from './doneGate';

describe('the gate between the checks passing and the work being done', () => {
  it('lets a write through that is not a move into a done state', () => {
    expect(doneRefusal({}, { priority: 80 })).toBeUndefined();
    expect(doneRefusal({}, { state: 'building' })).toBeUndefined();
  });

  it('refuses done while an acceptance criterion is unmet, and names it', () => {
    const current = {
      acceptance: [
        { statement: 'Every screen shows Stamp, not Send', met: false },
        { statement: 'stampsend.com serves the product', met: true },
      ],
    };
    const out = doneRefusal(current, { state: 'shipped' });

    expect(out).toMatch(/1 of 2 acceptance criteria are not met/);
    expect(out).toMatch(/Every screen shows Stamp/);
  });

  it('treats unchecked as unmet — nobody looked is not the same as it holds', () => {
    const current = { acceptance: [{ statement: 'Old links still resolve' }] };

    expect(doneRefusal(current, { state: 'accepted' })).toMatch(/not met/);
  });

  it('lets it through once every criterion is met', () => {
    const current = { acceptance: [{ statement: 'a', met: true }, { statement: 'b', met: true }] };

    expect(doneRefusal(current, { state: 'shipped' })).toBeUndefined();
  });

  it('refuses a visible change that nobody has looked at', () => {
    expect(doneRefusal({ surface: 'ui' }, { state: 'shipped' })).toMatch(/nothing shows what it looks like now/);
    expect(doneRefusal({ surface: 'flow' }, { state: 'shipped' })).toMatch(/after-shot/);
  });

  it('accepts a recorded reason for having no visual', () => {
    const current = { surface: 'ui', visuals: { noVisualReason: 'Text-only change inside an existing page.' } };

    expect(doneRefusal(current, { state: 'shipped' })).toBeUndefined();
  });

  it('accepts an after-shot', () => {
    expect(doneRefusal({ surface: 'ui', visuals: { afterArtifactIds: [91] } }, { state: 'shipped' })).toBeUndefined();
  });

  it('asks nothing visual of an answered question, or of work with no visible surface', () => {
    expect(doneRefusal({ surface: 'ui' }, { state: 'answered' })).toBeUndefined();
    expect(doneRefusal({ surface: 'infra' }, { state: 'shipped' })).toBeUndefined();
    expect(doneRefusal({}, { state: 'shipped' })).toBeUndefined();
  });

  it('reads the state and the contract from the same write, when both are set at once', () => {
    const out = doneRefusal({}, { state: 'shipped', acceptance: [{ statement: 'x', met: false }] });

    expect(out).toMatch(/not met/);
  });
});
