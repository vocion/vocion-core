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
  // place, with a soft wash of colour so the change is seen, not just there
  // on the next reload (Chris, 2026-10-03).
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const onArtifact = (e: Event) => {
      const next = (e as CustomEvent<ArtifactEntry>).detail;
      if (!next || next.id !== current.id || typeof next.version !== 'number' || next.version <= current.version) {
        return;
      }
      setCurrent(next);
      setFlash(true);
      // Held long enough to be seen from across a booth, then a slow fade.
      setTimeout(() => setFlash(false), 700);
    };
    window.addEventListener(ARTIFACT_EVENT, onArtifact);
    return () => window.removeEventListener(ARTIFACT_EVENT, onArtifact);
  }, [current.id, current.version]);
  return (
    <div
      data-artifact-flash={flash ? '' : undefined}
      className={`rounded-2xl transition-[background-color,box-shadow] ${flash ? 'bg-brand-amber-deep/15 shadow-[0_0_0_3px_var(--color-brand-amber-deep)] duration-0' : 'bg-transparent shadow-[0_0_0_3px_transparent] duration-[2600ms]'}`}
    >
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
