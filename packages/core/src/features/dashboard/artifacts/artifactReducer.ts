/**
 * Pure state for the artifact pane. No React, no DOM — tested on its own.
 *
 * ONE artifact is open beside the conversation at a time (0101). The reducer
 * owns three things the UI must not get wrong:
 *
 *  - which artifact is open, and that a new one from the agent takes over
 *    the pane unless the person deliberately opened something else;
 *  - `pending` artifacts, so a long agent write shows a shell filling in
 *    rather than an empty column;
 *  - the concurrent-edit case: the agent moved the head while the person had
 *    unsaved changes. That never silently overwrites — it raises a conflict
 *    the pane resolves as Review (take theirs) or Keep mine (write on top).
 */

import type { ArtifactPayload } from '@/services/agents/types';

/** An artifact in the pane. `pending` = the agent is still writing v1. */
export type ArtifactEntry = ArtifactPayload & { pending?: boolean };

export type ArtifactConflict = {
  /** The version the agent wrote while the person was editing. */
  theirVersion: number;
  /** The version the person started from. */
  mineFrom: number;
};

export type ArtifactPaneState = {
  /** Every artifact of the conversation, oldest first. */
  artifacts: ArtifactEntry[];
  /** The one in the pane. Null = pane closed. */
  openId: number | null;
  /**
   * Head version the person started editing from; null when there are no
   * unsaved edits. Set on the first keystroke, cleared on save or discard.
   */
  editingFrom: number | null;
  conflict: ArtifactConflict | null;
};

export type ArtifactAction
  = | { type: 'set'; artifacts: ArtifactEntry[] }
  /** A live event or a save landed. `focus` = take over the pane. */
    | { type: 'upsert'; artifact: ArtifactEntry; focus?: boolean }
    | { type: 'open'; id: number }
    | { type: 'close' }
    | { type: 'remove'; id: number }
    | { type: 'beginEdit' }
    | { type: 'endEdit' }
    | { type: 'dismissConflict' };

export const initialArtifactPaneState: ArtifactPaneState = { artifacts: [], openId: null, editingFrom: null, conflict: null };

/**
 * The open artifact, or null.
 * @param state
 */
export function openArtifact(state: ArtifactPaneState): ArtifactEntry | null {
  return state.artifacts.find(a => a.id === state.openId) ?? null;
}

/**
 * The newest artifact — what the pane falls back to when nothing is named.
 * @param state
 */
export function latestArtifact(state: ArtifactPaneState): ArtifactEntry | null {
  return state.artifacts.at(-1) ?? null;
}

/**
 * Fold one action into the pane state.
 * @param state
 * @param action
 */
export function artifactReducer(state: ArtifactPaneState, action: ArtifactAction): ArtifactPaneState {
  switch (action.type) {
    case 'set': {
      const openId = action.artifacts.some(a => a.id === state.openId) ? state.openId : action.artifacts.at(-1)?.id ?? null;
      return { ...state, artifacts: action.artifacts, openId };
    }
    case 'upsert': {
      const incoming = action.artifact;
      // A pending shell carries id -1 until the row exists: replace the
      // pending entry rather than stacking a second one beside it.
      const idx = incoming.pending
        ? state.artifacts.findIndex(a => a.pending)
        : state.artifacts.findIndex(a => a.id === incoming.id || (a.pending && a.kind === incoming.kind && a.title === incoming.title));
      const artifacts = idx >= 0
        ? state.artifacts.map((a, i) => (i === idx ? { ...a, ...incoming } : a))
        : [...state.artifacts, incoming];
      const previous = idx >= 0 ? state.artifacts[idx] : undefined;

      // The agent moved the head under an in-progress human edit.
      const conflict = state.editingFrom !== null
        && previous !== undefined
        && previous.id === state.openId
        && incoming.authorKind !== 'human'
        && incoming.version > state.editingFrom
        ? { theirVersion: incoming.version, mineFrom: state.editingFrom }
        : state.conflict;

      // A new artifact takes the pane; an update to one that is not open does
      // not steal focus from what the person is reading unless asked.
      const takesPane = action.focus === true || idx < 0 || previous?.id === state.openId;
      return {
        ...state,
        artifacts,
        openId: takesPane ? (incoming.pending ? state.openId ?? null : incoming.id) : state.openId,
        conflict,
      };
    }
    case 'open':
      return { ...state, openId: action.id, editingFrom: null, conflict: null };
    case 'close':
      return { ...state, openId: null, editingFrom: null, conflict: null };
    case 'remove': {
      const artifacts = state.artifacts.filter(a => a.id !== action.id);
      return {
        ...state,
        artifacts,
        openId: state.openId === action.id ? artifacts.at(-1)?.id ?? null : state.openId,
        editingFrom: state.openId === action.id ? null : state.editingFrom,
        conflict: state.openId === action.id ? null : state.conflict,
      };
    }
    case 'beginEdit': {
      if (state.editingFrom !== null) {
        return state;
      }
      const open = openArtifact(state);
      return open ? { ...state, editingFrom: open.version } : state;
    }
    case 'endEdit':
      return { ...state, editingFrom: null, conflict: null };
    case 'dismissConflict':
      return { ...state, conflict: null };
    default:
      return state;
  }
}
