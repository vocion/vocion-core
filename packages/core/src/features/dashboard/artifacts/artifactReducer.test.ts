import type { ArtifactEntry } from './artifactReducer';
import { describe, expect, it } from 'vitest';
import { artifactReducer, initialArtifactPaneState, latestArtifact, openArtifact } from './artifactReducer';

function art(id: number, over: Partial<ArtifactEntry> = {}): ArtifactEntry {
  return {
    id,
    conversationId: 1,
    kind: 'markdown',
    title: `a${id}`,
    spec: { md: 'x' },
    folder: null,
    version: 1,
    authorKind: 'agent',
    authorId: 'agent:lead',
    createdAt: '2026-09-15T00:00:00Z',
    updatedAt: '2026-09-15T00:00:00Z',
    ...over,
  };
}

describe('artifactReducer', () => {
  it('opens the newest artifact when a set arrives and keeps the open one if it survives', () => {
    let state = artifactReducer(initialArtifactPaneState, { type: 'set', artifacts: [art(1), art(2)] });

    expect(state.openId).toBe(2);

    state = artifactReducer(state, { type: 'open', id: 1 });
    state = artifactReducer(state, { type: 'set', artifacts: [art(1), art(2), art(3)] });

    expect(state.openId).toBe(1);
    expect(latestArtifact(state)?.id).toBe(3);
  });

  it('a new artifact takes the pane; an update to one that is not open does not steal focus', () => {
    let state = artifactReducer(initialArtifactPaneState, { type: 'set', artifacts: [art(1), art(2)] });
    state = artifactReducer(state, { type: 'open', id: 1 });

    state = artifactReducer(state, { type: 'upsert', artifact: art(2, { version: 2 }) });

    expect(state.openId).toBe(1);

    state = artifactReducer(state, { type: 'upsert', artifact: art(3) });

    expect(state.openId).toBe(3);
    expect(openArtifact(state)?.id).toBe(3);
  });

  it('an update to the OPEN artifact stays in the pane and carries the new version', () => {
    let state = artifactReducer(initialArtifactPaneState, { type: 'set', artifacts: [art(7)] });
    state = artifactReducer(state, { type: 'upsert', artifact: art(7, { version: 4, title: 'renamed' }) });

    expect(state.openId).toBe(7);
    expect(openArtifact(state)).toMatchObject({ version: 4, title: 'renamed' });
    expect(state.artifacts).toHaveLength(1);
  });

  it('a pending shell is replaced by the settled row rather than stacking beside it', () => {
    let state = artifactReducer(initialArtifactPaneState, { type: 'upsert', artifact: art(-1, { pending: true, version: 0, title: 'Release readiness' }) });

    expect(state.artifacts).toHaveLength(1);
    expect(state.artifacts[0]!.pending).toBe(true);

    state = artifactReducer(state, { type: 'upsert', artifact: art(11, { title: 'Release readiness', pending: false }), focus: true });

    expect(state.artifacts).toHaveLength(1);
    expect(state.artifacts[0]).toMatchObject({ id: 11, pending: false });
    expect(state.openId).toBe(11);
  });

  it('raises a conflict when the agent writes under an unsaved human edit, and never silently overwrites', () => {
    let state = artifactReducer(initialArtifactPaneState, { type: 'set', artifacts: [art(5, { version: 4 })] });
    state = artifactReducer(state, { type: 'beginEdit' });

    expect(state.editingFrom).toBe(4);

    state = artifactReducer(state, { type: 'upsert', artifact: art(5, { version: 5, authorKind: 'agent' }) });

    expect(state.conflict).toEqual({ theirVersion: 5, mineFrom: 4 });

    // Keeping mine writes on top: the save lands as v6 and clears the flag.
    state = artifactReducer(state, { type: 'dismissConflict' });
    state = artifactReducer(state, { type: 'upsert', artifact: art(5, { version: 6, authorKind: 'human' }) });
    state = artifactReducer(state, { type: 'endEdit' });

    expect(state.conflict).toBeNull();
    expect(state.editingFrom).toBeNull();
    expect(openArtifact(state)?.version).toBe(6);
  });

  it('a human’s own save is not a conflict', () => {
    let state = artifactReducer(initialArtifactPaneState, { type: 'set', artifacts: [art(5, { version: 2 })] });
    state = artifactReducer(state, { type: 'beginEdit' });
    state = artifactReducer(state, { type: 'upsert', artifact: art(5, { version: 3, authorKind: 'human' }) });

    expect(state.conflict).toBeNull();
  });

  it('removing the open artifact falls back to the newest remaining one', () => {
    let state = artifactReducer(initialArtifactPaneState, { type: 'set', artifacts: [art(1), art(2), art(3)] });
    state = artifactReducer(state, { type: 'remove', id: 3 });

    expect(state.openId).toBe(2);

    state = artifactReducer(state, { type: 'close' });

    expect(state.openId).toBeNull();
    expect(openArtifact(state)).toBeNull();
  });
});
