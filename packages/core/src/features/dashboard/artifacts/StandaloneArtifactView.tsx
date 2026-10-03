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
import { useVersionRefresh } from '@/features/dashboard/versions/VersionWatch';
import { client } from '@/libs/Orpc';
import { ArtifactPane } from './ArtifactPane';

export function StandaloneArtifactView({ artifact, selfId, workspaceSlug, conversationId }: {
  artifact: ArtifactPayload;
  selfId?: string | null;
  workspaceSlug?: string | null;
  /** The conversation it came out of, for the header's "Open in chat". */
  conversationId?: number | null;
}) {
  const [current, setCurrent] = useState<ArtifactEntry>(artifact as ArtifactEntry);
  // A version written from chat (or, for a record's body, from the record's
  // page) reloads it in place and marks what changed (backlog 035).
  useVersionRefresh({
    refs: [{ type: 'artifact', id: String(current.id) }],
    root: () => (typeof document === 'undefined' ? null : document.querySelector('[data-artifact-body]')),
    refetch: () => {
      client.artifacts.get({ id: current.id })
        .then(next => setCurrent(prev => ({ ...prev, ...(next as ArtifactEntry) })))
        .catch((error: unknown) => console.warn('StandaloneArtifactView: could not reload the new version', error));
    },
    settled: current.version,
    ready: true,
  });
  return (
    <div className={`rounded-2xl transition-colors ${flash ? 'bg-amber-200/50 duration-0' : 'bg-transparent duration-[1800ms]'}`}>
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
