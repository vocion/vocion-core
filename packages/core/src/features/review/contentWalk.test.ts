/**
 * A check is derived, never stored as a boolean.
 *
 * That one decision is what removes clearing logic from three places — the
 * regenerate route, the dedup refresh that lands a redraft, and the editor —
 * and the first one anybody forgot would have left a check standing over copy
 * nobody approved. These pin the rule itself, without mounting a component.
 */
import type { ReviewContent } from '@/libs/actions/types';
import { describe, expect, it } from 'vitest';
import { contentHash } from '@/libs/actions/contentHash';
import { approvableItems, isChecked, seedEditsFromApprovals, walkApplies, walkCount } from './contentWalk';

const send = (n: number, body = `Body ${n}.`): ReviewContent => ({
  kind: 'email',
  id: `send-${n}`,
  label: `Day ${n * 3}`,
  subject: `Subject ${n}`,
  body,
});

const photo: ReviewContent = { kind: 'image', id: 'photo', label: 'Pack station', url: 'https://example.test/a.jpg' };
const doc: ReviewContent = { kind: 'document', id: 'brief', label: 'Brief', href: 'https://example.test/b' };

/**
 * The check the server would have stored for a send, over the copy named.
 * @param n - The send's number.
 * @param body - The copy approved, when it is not the send's own.
 */
const approvalOf = (n: number, body?: string) =>
  ({ [`send-${n}`]: contentHash(`Subject ${n}`, body ?? `Body ${n}.`) });

describe('where the walk applies', () => {
  it('walks a sequence of two or more sends — the case it exists for', () => {
    expect(walkApplies([send(1), send(2)])).toBe(true);
    expect(walkApplies([send(1), send(2), send(3), send(4)])).toBe(true);
  });

  it('does not walk one item — approve then confirm is two clicks for one thing', () => {
    expect(walkApplies([send(1)])).toBe(false);
  });

  it('does not walk a card with no content at all', () => {
    expect(walkApplies([])).toBe(false);
  });

  it('counts only the items that carry copy — a photo is read, not vouched for', () => {
    expect(approvableItems([send(1), photo, doc]).map(i => i.id)).toEqual(['send-1']);
    expect(walkApplies([send(1), photo, doc])).toBe(false);
  });
});

describe('a check is derived from the copy it was given for', () => {
  it('stands while the copy is unchanged', () => {
    const item = send(1);

    expect(isChecked(item, undefined, approvalOf(1))).toBe(true);
  });

  it('clears when the body is edited after approval', () => {
    const item = send(1);

    expect(isChecked(item, { body: 'Edited.' }, approvalOf(1))).toBe(false);
  });

  it('clears when the subject is edited after approval', () => {
    const item = send(1);

    expect(isChecked(item, { subject: 'Different' }, approvalOf(1))).toBe(false);
  });

  it('clears when a regeneration replaces the copy underneath it', () => {
    // The approval was given for the old body; the run now carries the new
    // one. Nothing cleared the check — it simply no longer refers to this.
    const approved = approvalOf(1, 'The body that was approved.');

    expect(isChecked(send(1, 'What the redraft landed.'), undefined, approved)).toBe(false);
  });

  it('comes back when the copy is edited back to what was approved', () => {
    const item = send(1);

    expect(isChecked(item, { body: 'Edited.' }, approvalOf(1))).toBe(false);
    expect(isChecked(item, { body: 'Body 1.' }, approvalOf(1))).toBe(true);
  });

  it('is never set for an item nobody approved', () => {
    expect(isChecked(send(2), undefined, approvalOf(1))).toBe(false);
  });
});

describe('the count', () => {
  it('reads how many of the sends carry a standing check', () => {
    const content = [send(1), send(2), send(3), send(4)];
    const approvals = { ...approvalOf(1), ...approvalOf(2) };

    expect(walkCount(content, {}, approvals)).toEqual({ approved: 2, total: 4, complete: false });
  });

  it('is full only when every send carries one', () => {
    const content = [send(1), send(2)];
    const approvals = { ...approvalOf(1), ...approvalOf(2) };

    expect(walkCount(content, {}, approvals)).toEqual({ approved: 2, total: 2, complete: true });
  });

  it('drops back when an approved send is edited', () => {
    const content = [send(1), send(2)];
    const approvals = { ...approvalOf(1), ...approvalOf(2) };

    expect(walkCount(content, { 'send-2': { body: 'Changed.' } }, approvals)).toMatchObject({ approved: 1, complete: false });
  });
});

describe('an approved send brings its copy back with its check', () => {
  const item = send(1);
  const approvedBody = 'The copy the reviewer edited and then approved.';
  const check = { 'send-1': { hash: contentHash('Subject 1', approvedBody), at: '2026-09-18T12:00:00.000Z' } };
  const approvedRevision = { contentId: 'send-1', version: 2, kind: 'approved' as const, body: approvedBody, at: '2026-09-18T12:00:00.000Z' };

  it('restores the working edit behind a standing check', () => {
    expect(seedEditsFromApprovals([item], check, [approvedRevision])).toEqual({ 'send-1': { body: approvedBody } });
  });

  it('restores nothing when the approved copy is already what is rendered', () => {
    const unedited = send(1);
    const body = 'Body 1.';
    const sameCheck = { 'send-1': { hash: contentHash('Subject 1', body), at: '2026-09-18T12:00:00.000Z' } };

    expect(seedEditsFromApprovals([unedited], sameCheck, [{ ...approvedRevision, body }])).toEqual({});
  });

  it('does not resurrect copy a later regeneration replaced', () => {
    // Clicking Regenerate files a dated entry of its own, so an approval with
    // anything newer against the same send is stale. Restoring the old body
    // would hide the new draft behind it and leave a check standing over copy
    // that is no longer on screen.
    const laterAsk = { contentId: 'send-1', version: 3, kind: 'regenerated' as const, body: approvedBody, ask: 'shorter', at: '2026-09-19T09:00:00.000Z' };

    expect(seedEditsFromApprovals([item], check, [approvedRevision, laterAsk])).toEqual({});
  });

  it('restores nothing for a send with no check', () => {
    expect(seedEditsFromApprovals([item], {}, [approvedRevision])).toEqual({});
  });

  it('restores nothing when the check does not refer to the approved entry', () => {
    const otherCheck = { 'send-1': { hash: 'deadbeefdeadbeef', at: '2026-09-18T12:00:00.000Z' } };

    expect(seedEditsFromApprovals([item], otherCheck, [approvedRevision])).toEqual({});
  });
});
