import { describe, expect, it } from 'vitest';
import { linkedArtifactIds, mergeArtifactChips } from './artifactRefs';

describe('the artifacts an answer links to (2026-10-23)', () => {
  it('reads artifact links in the order named, once each, with or without a workspace prefix', () => {
    const text = 'See [artifact #41](/w/larkfield/dashboard/artifacts/41), the [deck](/dashboard/artifacts/7/open) and [artifact #41](/dashboard/artifacts/41) again.';

    expect(linkedArtifactIds(text)).toEqual([41, 7]);
  });

  it('never guesses from a bare number or another kind of link', () => {
    expect(linkedArtifactIds('Artifact 41 and [a record](/dashboard/objects/41).')).toEqual([]);
  });
});

describe('one chip per artifact', () => {
  const chart = { id: 41, title: 'Cumulative revenue', kind: 'chart' as const, version: 2 };

  it('keeps a re-render as one chip at its newest version', () => {
    expect(mergeArtifactChips([chart, { ...chart, version: 3 }])).toEqual([{ ...chart, version: 3 }]);
  });

  it('adds what the answer only named, marked as named, after what it wrote', () => {
    const deck = { id: 7, title: 'Board deck', kind: 'deck' as const, version: 4 };

    expect(mergeArtifactChips([chart], [deck, { ...chart, version: 9 }])).toEqual([chart, { ...deck, referenced: true }]);
  });
});
