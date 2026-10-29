import { describe, expect, it } from 'vitest';
import { isOutwardOrIrreversible } from './outward';
import { getAction } from './registry';

const undo = async () => {};
const kind = (over: Record<string, unknown>) => ({ id: 'test.kind', grant: 'test', external: false, ...over }) as never;

describe('isOutwardOrIrreversible', () => {
  it('holds what goes out and cannot be put back', () => {
    expect(isOutwardOrIrreversible(kind({ external: true }))).toBe(true);
    expect(isOutwardOrIrreversible(kind({ external: true, undo }))).toBe(false);
  });

  it('holds what the platform or the kind itself always holds', () => {
    expect(isOutwardOrIrreversible(kind({ requiresReviewDecision: true, undo }))).toBe(true);
    expect(isOutwardOrIrreversible(kind({ grant: 'send_email', external: true, undo }))).toBe(true);
    expect(isOutwardOrIrreversible(kind({ approvalRequired: true, undo }))).toBe(true);
  });

  it('reads a kind whose undo covers some inputs only, per input', () => {
    const draftsOnly = kind({ external: true, undo, undoableFor: (i: { mode?: string }) => i.mode === 'draft' });

    expect(isOutwardOrIrreversible(draftsOnly, { mode: 'draft' })).toBe(false);
    expect(isOutwardOrIrreversible(draftsOnly, { mode: 'send' })).toBe(true);
  });

  it('leaves internal, reversible work to the ladder', () => {
    expect(isOutwardOrIrreversible(kind({ undo }))).toBe(false);
    expect(isOutwardOrIrreversible(kind({}))).toBe(false);
  });

  it('holds both publish actions', () => {
    expect(isOutwardOrIrreversible(getAction('site.publish_live')!)).toBe(true);
    expect(isOutwardOrIrreversible(getAction('site.publish_page')!)).toBe(true);
  });
});
