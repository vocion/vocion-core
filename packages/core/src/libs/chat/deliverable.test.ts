import { describe, expect, it } from 'vitest';
import { ARTIFACT_TAG, DELIVERABLE_REF_TYPE, deliverableFromRefs, isArtifactTag, readDeliverable } from './deliverable';

const ARTIFACT = { type: DELIVERABLE_REF_TYPE, id: ARTIFACT_TAG };

/**
 * The contract is armed by a tag the person typed, not by anything inferred
 * from the draft. These two functions are the whole parse.
 */
describe('deliverableFromRefs', () => {
  it('reads `@artifact` in the composer as a turn that owes a document', () => {
    expect(deliverableFromRefs([ARTIFACT])).toBe('artifact');
    expect(deliverableFromRefs([{ type: 'team', id: 'revops' }, ARTIFACT])).toBe('artifact');
  });

  it('is `answer` with no tag, and with tags that are not it', () => {
    expect(deliverableFromRefs([])).toBe('answer');
    expect(deliverableFromRefs([{ type: 'team', id: 'revops' }, { type: 'page', id: '/dashboard' }])).toBe('answer');
  });

  it('never arms on a near miss — a record that merely says "artifact"', () => {
    // `artifact` IS a RECORD_TYPE (the artifact open beside the conversation).
    // Tagging one must not silently promise a new one.
    expect(deliverableFromRefs([{ type: 'artifact', id: '42' }])).toBe('answer');
    expect(isArtifactTag({ type: 'artifact', id: 'artifact' })).toBe(false);
    expect(isArtifactTag({ type: DELIVERABLE_REF_TYPE, id: 'something-else' })).toBe(false);
  });
});

describe('readDeliverable', () => {
  it('accepts the two values and nothing else', () => {
    expect(readDeliverable('artifact')).toBe('artifact');
    expect(readDeliverable('answer')).toBe('answer');
    expect(readDeliverable('Artifact')).toBeUndefined();
    expect(readDeliverable(undefined)).toBeUndefined();
    expect(readDeliverable(null)).toBeUndefined();
    expect(readDeliverable(1)).toBeUndefined();
    expect(readDeliverable({ deliverable: 'artifact' })).toBeUndefined();
  });
});
