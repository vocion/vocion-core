'use client';

/**
 * The compact chips under a turn that produced or changed an artifact —
 * "📄 Release readiness · v3 updated". They exist because the pane shows
 * only the CURRENT artifact: without a mark in the transcript there is
 * nothing to say which turn made which thing, and scrolling back through a
 * long conversation stops answering "where did this come from".
 *
 * Clicking one opens it in the pane.
 */

import type { ChatMessageArtifact } from './types';
import { ARTIFACT_KIND_ICON, ARTIFACT_KIND_LABEL } from '@/features/dashboard/artifacts/kinds';

export function ArtifactChips({ artifacts, onOpen }: {
  artifacts: ChatMessageArtifact[];
  onOpen?: (id: number) => void;
}) {
  if (artifacts.length === 0) {
    return null;
  }
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" data-artifact-chips>
      {artifacts.map((a) => {
        const Icon = ARTIFACT_KIND_ICON[a.kind];
        const label = `v${a.version} ${a.version > 1 ? 'updated' : 'created'}`;
        return (
          <li key={`${a.id}-${a.version}`}>
            <button
              type="button"
              onClick={() => onOpen?.(a.id)}
              disabled={!onOpen}
              data-artifact-chip={a.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[12px] font-medium text-foreground/85 transition hover:border-brand-amber/40 hover:text-foreground disabled:cursor-default disabled:opacity-70"
              title={`${ARTIFACT_KIND_LABEL[a.kind]} · ${label}`}
            >
              <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{a.title}</span>
              <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
                ·
                {' '}
                {label}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
