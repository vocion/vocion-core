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
import { useState } from 'react';
import { ArtifactPane } from './ArtifactPane';

export function StandaloneArtifactView({ artifact, selfId, workspaceSlug, conversationId }: {
  artifact: ArtifactPayload;
  selfId?: string | null;
  workspaceSlug?: string | null;
  /** The conversation it came out of, for the header's "Open in chat". */
  conversationId?: number | null;
}) {
  const [current, setCurrent] = useState<ArtifactEntry>(artifact as ArtifactEntry);
  return (
    <ArtifactPane
      key={current.id}
      artifact={current}
      selfId={selfId}
      workspaceSlug={workspaceSlug}
      onUpdated={setCurrent}
      surface="page"
      conversationId={conversationId ?? null}
    />
  );
}
