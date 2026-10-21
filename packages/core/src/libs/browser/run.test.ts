import { describe, expect, it } from 'vitest';
import { isLive, needsApproval } from './run';

describe('the approval rule a browser run cannot talk its way past', () => {
  it('holds a button that submits, sends, pays, saves or deletes', () => {
    for (const name of ['Save changes', 'Submit', 'Pay now', 'Send invoice', 'Delete account', 'Place order', 'Confirm transfer', 'Update address']) {
      expect(needsApproval({ role: 'button', name })).toBe(true);
    }
  });

  it('lets a person-style read through: signing in, filtering, opening, cancelling a form', () => {
    for (const name of ['Sign in', 'Filter', 'Next', 'Accept all', 'Reject optional', 'Search', 'Download PDF', 'Cancel']) {
      expect(needsApproval({ role: 'button', name })).toBe(false);
    }
  });

  it('never holds a link: "Order history" is a place, not an order', () => {
    expect(needsApproval({ role: 'link', name: 'Delete history' })).toBe(false);
    expect(needsApproval({ role: null, name: 'Save' })).toBe(false);
  });

  it('counts queued, running and waiting as holding the browser', () => {
    expect(['queued', 'running', 'waiting'].every(isLive)).toBe(true);
    expect(['proposed', 'done', 'failed', 'stopped'].some(isLive)).toBe(false);
  });
});
