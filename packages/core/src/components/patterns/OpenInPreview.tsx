'use client';

import type { RecordRef } from '@/services/chat/pageContext';
import { PanelRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useOpenPreviewRef, usePreviewOpener } from '@/features/preview/previewState';
import { previewKey } from '@/libs/preview/types';
import { cn } from '@/utils/Helpers';

/**
 * OPEN IN PREVIEW — the row action beside a record link (Chris, 2026-09-30:
 * the run page's Feature, Plan, Other attempts and Acceptance rows). The link
 * text goes to the record's full page; this small button opens the same
 * record in the one preview pane and leaves the page where it is.
 *
 * It is the pane's own opener (`usePreviewOpener`, the one `PreviewOpen` and
 * the chat's record chips use), drawn as an icon. On a pointer device it
 * shows on the row's hover or its own focus — its row carries `group/row`
 * (`FactList` does); on a touch device, which has no hover, it always shows.
 * While its record is the one open it stays visible and reads as pressed.
 * A link with no preview (a pull request on GitHub) carries none.
 * @param props
 * @param props.recordRef - What the pane opens.
 * @param props.label - What the button says to a screen reader, and its Tooltip.
 * @param props.className - Extra classes.
 */
export function OpenInPreview({ recordRef, label = 'Open in preview', className }: { recordRef: Pick<RecordRef, 'type' | 'id'>; label?: string; className?: string }) {
  const open = usePreviewOpener(recordRef);
  const active = useOpenPreviewRef();
  const isOpen = active !== null && previewKey(active) === previewKey(recordRef);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={open}
          aria-label={label}
          aria-pressed={isOpen}
          data-testid="open-in-preview"
          data-preview-key={previewKey(recordRef)}
          className={cn(
            'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
            // Hover-revealed where there is hover; always there on touch.
            'opacity-0 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100',
            isOpen && 'text-foreground opacity-100',
            className,
          )}
        >
          <PanelRight className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
