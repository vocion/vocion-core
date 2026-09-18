'use client';

/**
 * The artifact pane on its own page — the same component, with local state
 * standing in for the conversation's reducer. Used by
 * `/dashboard/artifacts/[id]`: an artifact whose conversation is gone, a
 * mission file, or a link someone was sent.
 */

import type { ArtifactEntry } from './artifactReducer';
import type { ArtifactPayload } from '@/services/agents/types';
import { useState } from 'react';
import { ArtifactPane } from './ArtifactPane';

export function StandaloneArtifactView({ artifact, selfId, workspaceSlug }: {
  artifact: ArtifactPayload;
  selfId?: string | null;
  workspaceSlug?: string | null;
}) {
  const [current, setCurrent] = useState<ArtifactEntry>(artifact as ArtifactEntry);
  return (
    <ArtifactPane
      key={current.id}
      artifact={current}
      selfId={selfId}
      workspaceSlug={workspaceSlug}
      onUpdated={setCurrent}
      scroll="page"
    />
  );
}
