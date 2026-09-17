'use client';

import type { LeadArtifactRef } from '@/services/personalization/artifacts';
import { PanelRight } from 'lucide-react';
import { usePreviewOpener } from '@/features/preview/previewState';

/**
 * "Keep this beside me while I work on that."
 *
 * Chris, 2026-09-17: *"when I'm on a review page, i have a use case of wanting
 * to see the brief or evidence in sidebar preview, while i edit the sequence
 * content."*
 *
 * The sequence is the work and the brief is the justification, so reading one
 * while editing the other is the normal motion of this page — and tabs make it
 * impossible, because they are mutually exclusive by construction. Switching to
 * Brief to check a fact means abandoning the send you were halfway through
 * writing.
 *
 * Nothing new is needed to fix it: since 0112 the brief, the recommendation and
 * the sequence are record-bound ARTIFACTS, `registerPreview('artifact', …)`
 * already resolves them, and the right column already stacks a preview above
 * the chat. This is the control that was missing — one button per artifact that
 * stands it in the panel, leaving the page where it was.
 *
 * It deliberately does not navigate and does not change the tab: the point is
 * that you keep your place.
 * @param root0
 * @param root0.artifact
 */
function ReferenceButton({ artifact }: { artifact: LeadArtifactRef }) {
  const open = usePreviewOpener(artifact.ref);
  return (
    <button
      type="button"
      onClick={open}
      data-testid={`reference-${artifact.role}`}
      title={`Open the ${artifact.role} in the side panel, without leaving the sequence`}
      className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <PanelRight className="size-3.5" aria-hidden />
      {artifact.title}
    </button>
  );
}

/**
 * The row of "open this beside me" controls.
 * @param props - The artifacts to offer.
 * @param props.artifacts - The lead's artifacts.
 * @param props.exclude - The role being edited; it is already on screen.
 */
export function ReferenceRow({ artifacts, exclude }: { artifacts: LeadArtifactRef[]; exclude?: string }) {
  // Never offer to preview the thing you are looking at — that is the
  // "two copies of the same page" failure `patterns.md` bans for the rail.
  const offered = artifacts.filter(a => a.role !== exclude);
  if (offered.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
      <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
        Keep beside me
      </span>
      {offered.map(a => <ReferenceButton key={a.id} artifact={a} />)}
    </div>
  );
}
