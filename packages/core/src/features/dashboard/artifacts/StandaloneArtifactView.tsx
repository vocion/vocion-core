'use client';

/**
 * The artifact pane on its own page — the same component, wearing the same
 * `ArtifactHeader`, with local state standing in for the conversation's
 * reducer. Used by `/dashboard/artifacts/[id]`: an artifact whose conversation
 * is gone, a mission file, or a link someone was sent.
 *
 * `surface="page"` is the whole difference, and it is one line in
 * `actionsFor`: a page has no column to close and IS the surface that offers
 * "Open in chat", because it is the one that is not already in a chat.
 */

import type { ArtifactEntry } from './artifactReducer';
import type { ArtifactPayload } from '@/services/agents/types';
import { useEffect, useState } from 'react';
import { ARTIFACT_EVENT } from './artifactEvents';
import { ArtifactPane } from './ArtifactPane';

export function StandaloneArtifactView({ artifact, selfId, workspaceSlug, conversationId }: {
  artifact: ArtifactPayload;
  selfId?: string | null;
  workspaceSlug?: string | null;
  /** The conversation it came out of, for the header's "Open in chat". */
  conversationId?: number | null;
}) {
  const [current, setCurrent] = useState<ArtifactEntry>(artifact as ArtifactEntry);
  // A newer version announced by the chat beside this page lands here in
  // place. No wash of colour: the content changing where the reader is
  // looking is the signal, and a tour that wants eyes on the changed line
  // scrolls to it and rings it (Chris, 2026-10-03).
  useEffect(() => {
    const onArtifact = (e: Event) => {
      const next = (e as CustomEvent<ArtifactEntry>).detail;
      if (!next || next.id !== current.id || typeof next.version !== 'number' || next.version <= current.version) {
        return;
      }
      setCurrent(next);
    };
    window.addEventListener(ARTIFACT_EVENT, onArtifact);
    return () => window.removeEventListener(ARTIFACT_EVENT, onArtifact);
  }, [current.id, current.version]);
  return (
    <div className="rounded-2xl">
      <ArtifactPane
        key={`${current.id}:${current.version}`}
        artifact={current}
        selfId={selfId}
        workspaceSlug={workspaceSlug}
        onUpdated={setCurrent}
        surface="page"
        conversationId={conversationId ?? null}
      />
    </div>
  );
}
