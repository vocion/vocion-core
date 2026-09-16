'use client';

/**
 * Renders one artifact through the cards registry — the ONLY render path for
 * table/markdown/chart/record/link/file, on both surfaces. Chat callers pass
 * `surface="chat"` (dense); the pane passes `surface="artifact"` (full).
 */

import type { ArtifactPayload } from '@/services/agents/types';
import { useMemo } from 'react';
import { resolveCard } from '@/libs/cards';
import { cardPayloadFor } from '@/libs/cards/specs';

export function ArtifactCard({ artifact, surface }: { artifact: ArtifactPayload; surface: 'chat' | 'artifact' }) {
  const resolved = useMemo(() => resolveCard(cardPayloadFor(artifact.kind, artifact.spec), { surface }), [artifact, surface]);
  const { Renderer } = resolved.renderer;
  return (
    <div data-artifact-id={artifact.id} data-card={resolved.slug}>
      <Renderer data={resolved.data} surface={surface} />
      {resolved.fallbackReason && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Shown raw —
          {resolved.fallbackReason}
        </p>
      )}
    </div>
  );
}
