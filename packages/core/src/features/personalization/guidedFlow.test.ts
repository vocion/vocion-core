import type { ReviewCard } from '@/libs/actions/types';
import { describe, expect, it } from 'vitest';
import {
  applyRevision,
  canDecide,
  contentEditsFor,
  currentBody,
  initialGuidedState,
  isRevisionAsk,
  markRead,
  revisionList,
  sendsFromCard,
  targetOf,
  versionOf,
} from './guidedFlow';

const CARD = {
  title: 'New MQL ready to enroll',
  fields: [],
  content: [
    { kind: 'email', id: 'send-1', label: 'Day 1', subject: 'the guide', body: 'draft one' },
    { kind: 'email', id: 'send-2', label: 'Day 3', subject: 'a peer example', body: 'draft two' },
    { kind: 'email', id: 'send-3', label: 'Day 6', subject: 'the question', body: 'draft three' },
  ],
} as unknown as ReviewCard;

const SENDS = sendsFromCard(CARD);
/** Walk to the end without revising anything. */
const walked = { ...initialGuidedState, step: SENDS.length };

describe('the guided flow', () => {
  it('takes its sends from the card, in order', () => {
    expect(SENDS.map(s => s.id)).toEqual(['send-1', 'send-2', 'send-3']);
    expect(SENDS[1]).toMatchObject({ position: 2, subject: 'a peer example', body: 'draft two' });
  });

  it('offers the decision only once every send has been walked', () => {
    expect(canDecide(initialGuidedState, SENDS)).toBe(false);
    expect(canDecide({ ...initialGuidedState, step: 2 }, SENDS)).toBe(false);
    expect(canDecide(walked, SENDS)).toBe(true);
  });

  it('a revision to the send under review does not block the decision', () => {
    const reviewing2 = { ...initialGuidedState, step: 1 };
    const after = applyRevision(reviewing2, SENDS, 'send-2', 'tighter two', 'make send 2 shorter');

    expect(after.unread).toEqual([]);
    expect(currentBody(SENDS[1]!, after)).toBe('tighter two');
    expect(versionOf(SENDS[1]!, after)).toBe(2);
  });

  it('a revision to a send NOT under review withholds the decision until it is re-read', () => {
    const after = applyRevision(walked, SENDS, 'send-1', 'tighter one', 'make send 1 shorter');

    expect(after.unread).toEqual(['send-1']);
    expect(canDecide(after, SENDS)).toBe(false);

    expect(canDecide(markRead(after, 'send-1'), SENDS)).toBe(true);
  });

  it('approval carries the revised copy, so what persists is what was on screen', () => {
    const after = applyRevision(walked, SENDS, 'send-2', 'tighter two', 'shorter');

    expect(contentEditsFor(after, SENDS)).toEqual([{ id: 'send-2', body: 'tighter two' }]);
    expect(contentEditsFor(walked, SENDS)).toEqual([]);
  });

  it('successive revisions keep the latest, and version counts up from the draft', () => {
    const once = applyRevision(walked, SENDS, 'send-2', 'v2 body', 'shorter');
    const twice = applyRevision(once, SENDS, 'send-2', 'v3 body', 'warmer');

    expect(currentBody(SENDS[1]!, twice)).toBe('v3 body');
    expect(versionOf(SENDS[1]!, twice)).toBe(3);
    expect(revisionList(twice, SENDS)).toHaveLength(1);
    expect(revisionList(twice, SENDS)[0]!.ask).toBe('warmer');
  });

  it('an ask names its send, or addresses the one under review', () => {
    expect(targetOf('make send 3 warmer', SENDS, initialGuidedState)?.id).toBe('send-3');
    expect(targetOf('make it shorter', SENDS, { ...initialGuidedState, step: 1 })?.id).toBe('send-2');
    // A number that is not a send falls back to the one under review.
    expect(targetOf('make send 9 shorter', SENDS, { ...initialGuidedState, step: 0 })?.id).toBe('send-1');
  });

  it('a question is answered, never counted as a change', () => {
    expect(isRevisionAsk('make send 2 shorter')).toBe(true);
    expect(isRevisionAsk('soften the close')).toBe(true);
    expect(isRevisionAsk('what is this claim based on?')).toBe(false);
    expect(isRevisionAsk('why day 6?')).toBe(false);
    expect(isRevisionAsk('who is this person')).toBe(false);
    expect(isRevisionAsk('')).toBe(false);
  });

  it('a decided lead offers no further decision', () => {
    expect(canDecide({ ...walked, decided: true }, SENDS)).toBe(false);
  });
});
