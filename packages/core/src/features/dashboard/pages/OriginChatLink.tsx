'use client';

import { MessageSquare } from 'lucide-react';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePreviewOpener } from '@/features/preview/previewState';

/**
 * The chat a record started in, as a small icon at the card's corner: it
 * opens the conversation in the preview pane, and says which in its Tooltip.
 * @param props
 * @param props.origin - The conversation.
 * @param props.origin.conversationId
 * @param props.origin.title
 * @param props.origin.href
 */
export function OriginChatLink({ origin }: { origin: { conversationId: number; title: string; href: string | null } }) {
  const open = usePreviewOpener({ type: 'conversation', id: String(origin.conversationId) });
  const said = `Started in chat: ${origin.title}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={origin.href ?? undefined}
          onClick={(e) => {
            e.preventDefault();
            open(e);
          }}
          aria-label={said}
          data-testid="row-origin-chat"
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        >
          <MessageSquare className="size-3.5" aria-hidden />
        </a>
      </TooltipTrigger>
      <TooltipContent>{said}</TooltipContent>
    </Tooltip>
  );
}
