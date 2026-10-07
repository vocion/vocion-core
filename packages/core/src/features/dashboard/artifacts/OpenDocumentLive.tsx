'use client';

/**
 * The full-screen document (`/artifacts/:id/open`) takes a newer version live.
 *
 * The page is a server read of ONE version, so on its own it never learns that
 * the agent beside it just wrote v2 — the deck stayed on v1 while the chat said
 * "version two is beside you" (Chris, 2026-10-07, Kickoff walkthrough). When
 * the chat session announces a newer version of this artifact, refresh the
 * route: the header's version line and the frame's version-keyed src update in
 * place, which is the same "it changes where you are looking" the pane does.
 * @param props
 * @param props.id
 * @param props.version
 */

import { useEffect } from 'react';
import { useRouter } from '@/libs/I18nNavigation';
import { ARTIFACT_EVENT } from './artifactEvents';

export function OpenDocumentLive(props: { id: number; version: number }) {
  const router = useRouter();
  useEffect(() => {
    const onArtifact = (e: Event) => {
      const next = (e as CustomEvent<{ id?: number; version?: number }>).detail;
      if (next && next.id === props.id && typeof next.version === 'number' && next.version > props.version) {
        router.refresh();
      }
    };
    window.addEventListener(ARTIFACT_EVENT, onArtifact);
    return () => window.removeEventListener(ARTIFACT_EVENT, onArtifact);
  }, [props.id, props.version, router]);
  return null;
}
