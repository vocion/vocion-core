'use client';

import { History } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AskAboutThis } from '@/features/dashboard/context/AskAboutThis';
import { openPreview } from '@/features/preview/previewState';

/**
 * A record page declares its Change intent (backlog 035) — one element,
 * rendered once anywhere on the page, the way `RecordContext` declares the
 * record.
 *
 * A record's body is an artifact, so selecting words on it offers the SAME
 * two verbs an artifact does, through the same `AskAboutThis` toolbar: Ask
 * opens the conversation with the passage quoted; Change opens it with the
 * passage and the change intent, and the agent changes the record the way it
 * changes any artifact — `read_artifact`, edit, `update_artifact` — which
 * lands as an `objects.update_meta` write: done for the person with Undo
 * under the workspace's trust rule, a new version of the body, and on its
 * History. The page refreshes in place and marks what changed
 * (`versions/VersionWatch`).
 *
 * `History` is the one visible control: it opens the record's versions in
 * the preview panel (`record_history`), where each carries Restore.
 * @param props - Component props.
 * @param props.objectId - The record (`business_object.id`).
 * @param props.title - The record's title, for the conversation's chip.
 * @param props.selectionRoot - CSS selector for the region whose text belongs to the record.
 * @param props.showHistory - Render the History control here (default true).
 */
export function RecordChangeIntent({ objectId, title, selectionRoot, showHistory = true }: { objectId: number; title?: string; selectionRoot: string; showHistory?: boolean }) {
  return (
    <>
      <AskAboutThis
        record={{ type: 'object', id: String(objectId), ...(title ? { label: title } : {}) }}
        selectionRoot={selectionRoot}
        variant="none"
        changeable
      />
      {showHistory && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={e => openPreview({ type: 'record_history', id: String(objectId) }, e.currentTarget)}
              data-testid="record-history-open"
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <History className="size-3.5" aria-hidden />
              History
            </button>
          </TooltipTrigger>
          <TooltipContent>Every version of this record — who, when, why — with Restore</TooltipContent>
        </Tooltip>
      )}
    </>
  );
}
