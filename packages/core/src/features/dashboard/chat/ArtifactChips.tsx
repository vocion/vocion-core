'use client';

/**
 * The compact chips under a turn that produced or changed an artifact —
 * "📄 Release readiness · v3 updated". They exist because the pane shows
 * only the CURRENT artifact: without a mark in the transcript there is
 * nothing to say which turn made which thing, and scrolling back through a
 * long conversation stops answering "where did this come from".
 *
 * Clicking one opens it: in the artifact PANE where a surface has one, and in
 * the preview panel everywhere else.
 *
 * That fallback is the point. The pane only exists on the expanded
 * conversation route, so on the plain chat page the chip had no handler, came
 * up disabled, and an artifact the turn had genuinely produced was
 * unreachable — Chris, 2026-09-17: *"it's still not triggering the artifact
 * sidebar."* The preview panel resolves an artifact ref on any surface, so it
 * is the honest default rather than a dead control.
 */

import type { ChatMessageArtifact } from './types';
import { ARTIFACT_KIND_ICON, ARTIFACT_KIND_LABEL } from '@/features/dashboard/artifacts/kinds';
import { openPreview } from '@/features/preview/previewState';

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
          // `min-w-0` twice, and both are load-bearing: the chip's `truncate`
          // span is `white-space: nowrap`, so its min-content is the whole
          // title — which the `li` then reported to the wrapping row and the
          // row reported to the transcript. A document title is long by
          // nature, so the chip has to be the thing that gives.
          <li key={`${a.id}-${a.version}`} className="max-w-full min-w-0">
            <button
              type="button"
              onClick={ev => (onOpen
                ? onOpen(a.id)
                : openPreview({ type: 'artifact', id: String(a.id) }, ev.currentTarget))}
              data-artifact-chip={a.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[12px] font-medium text-foreground/85 transition hover:border-brand-amber/40 hover:text-foreground"
              title={`${ARTIFACT_KIND_LABEL[a.kind]} · ${label}`}
            >
              <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate">{a.title}</span>
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
