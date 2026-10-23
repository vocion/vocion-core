'use client';

/**
 * Remove — the undo of a filing, on the source's row. One click; the row
 * goes, the document stays in the knowledge base, and the collector will not
 * put it back on its own. No confirm dialog: the action is reversible (file
 * it again from chat) and the page shows the result at once.
 */

import { X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useRouter } from '@/libs/I18nNavigation';

export function UnfileSource({ roomId, documentId, artifactId, title }: { roomId: number; documentId?: number; artifactId?: number; title: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const qs = documentId ? `document=${documentId}` : `artifact=${artifactId}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={busy}
          aria-label={`Remove ${title} from this room`}
          data-room-unfile
          onClick={() => start(async () => {
            const res = await fetch(`/api/v1/rooms/${roomId}/sources?${qs}`, { method: 'DELETE' });
            if (!res.ok) {
              setFailed(true);
              return;
            }
            router.refresh();
          })}
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm', className: failed ? 'text-destructive' : undefined })}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Remove from this room</TooltipContent>
    </Tooltip>
  );
}
