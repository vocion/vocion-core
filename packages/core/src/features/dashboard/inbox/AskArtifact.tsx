'use client';

import type { SheetArtifact } from './AskSheet';
import { PanelRight } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openPreview } from '@/features/preview/previewState';

/**
 * The artifact an ask is about, on the decision sheet: a sign-off is a
 * judgement of a draft, so the draft is read where the answer is given (SEO
 * walk 2, 2026-10-27: the card showed the meta and the editor's report and no
 * way to read the page). A markdown artifact is rendered in place; every kind
 * opens in the pane beside the sheet in one move, as the dock's "Open it"
 * does.
 * @param props - The artifact.
 * @param props.artifact - The ask's primary artifact.
 */
export function AskArtifact({ artifact }: { artifact: SheetArtifact }) {
  const label = artifact.kind === 'markdown' ? 'the draft' : 'it';
  return (
    <section className="mt-4 border-y border-rule" aria-label={`${artifact.title}, version ${artifact.version}`} data-testid="ask-artifact">
      <div className="flex items-center justify-between gap-3 py-2">
        <p className="min-w-0 truncate text-sm font-medium">
          {artifact.title}
          <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">{`v${artifact.version}`}</span>
        </p>
        <button
          type="button"
          onClick={ev => openPreview({ type: 'artifact', id: String(artifact.id) }, ev.currentTarget)}
          className="inline-flex min-h-10 shrink-0 items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
          data-testid="ask-open-artifact"
        >
          <PanelRight className="size-3.5" aria-hidden />
          {`Open ${label}`}
        </button>
      </div>
      {artifact.markdown && (
        <div className="max-h-[28rem] overflow-y-auto border-t border-rule py-3" data-testid="ask-artifact-preview">
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <Markdown remarkPlugins={[remarkGfm]}>{artifact.markdown}</Markdown>
          </div>
        </div>
      )}
    </section>
  );
}
