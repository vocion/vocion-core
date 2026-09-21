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
import { cn } from '@/utils/Helpers';

/**
 * `className` is how a host that owns the height passes it through: a document
 * fills its pane and scrolls itself, so this wrapper has to grow rather than
 * sit at its content height between two flex items that do (the artifact pane
 * passes `flex min-h-0 flex-1 flex-col`). Every other caller passes nothing and
 * gets the plain block box it always had.
 * @param props
 * @param props.artifact
 * @param props.surface
 * @param props.className
 */
export function ArtifactCard({ artifact, surface, className }: { artifact: ArtifactPayload; surface: 'chat' | 'artifact'; className?: string }) {
  const resolved = useMemo(() => resolveCard(cardPayloadFor(artifact.kind, artifact.spec, artifact.id > 0 ? artifact.id : undefined), { surface }), [artifact, surface]);
  const { Renderer } = resolved.renderer;
  return (
    <div data-artifact-id={artifact.id} data-card={resolved.slug} className={cn(className)}>
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
