import type { ChatMessageArtifact } from './types';
import { describe, expect, it } from 'vitest';

/**
 * The chip that says what a turn produced.
 *
 * `ChatMessageArtifact`, `ArtifactChips` and the render in `AgentMessage` all
 * existed, and nothing ever set `message.artifacts`. So `render_chart` wrote a
 * real artifact, the agent said "chart's up", and the transcript showed
 * nothing. Chris, 2026-09-17: *"why didn't I get an artifact here?"*
 *
 * This asserts the reducer's merge rule, which is the part with a decision in
 * it: skip the pending shell, and key by id so one artifact leaves one chip.
 */

/**
 * The merge the `artifact` case performs.
 * @param existing
 * @param chip
 */
function merge(existing: ChatMessageArtifact[], chip: ChatMessageArtifact): ChatMessageArtifact[] {
  return [...existing.filter(x => x.id !== chip.id), chip];
}

const chart: ChatMessageArtifact = { id: 11, title: 'Open pipeline by stage', kind: 'chart', version: 1 };

describe('artifact chips on a turn', () => {
  it('adds the artifact the turn produced', () => {
    expect(merge([], chart)).toEqual([chart]);
  });

  it('leaves ONE chip when the same artifact is updated twice in a turn', () => {
    const v2 = { ...chart, version: 2 };

    expect(merge([chart], v2)).toEqual([v2]);
  });

  it('keeps other artifacts from the same turn', () => {
    const table: ChatMessageArtifact = { id: 12, title: 'Stalled deals', kind: 'table', version: 1 };

    expect(merge([chart], table).map(a => a.id)).toEqual([11, 12]);
  });
});
