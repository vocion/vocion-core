'use client';

import { X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/utils/Helpers';

/**
 * The one close control for a side panel — preview pane, sources panel, the
 * rail's sheet. Same 32px round ghost as the rail header's other controls,
 * same tone, so three panels do not close three different ways
 * (principle 6). The caller supplies the accessible name because "Close
 * preview" and "Back to chat" are different promises.
 *
 * The hover text is the Tooltip component, never a native `title=` — the
 * browser's own bubble arrives late, unstyled, and not at all on touch.
 * @param props
 * @param props.onClick
 * @param props.label - Accessible name.
 * @param props.tooltip - What the hover says, when it says more than the name (a shortcut); defaults to `label`.
 * @param props.icon - Override the glyph (the sheet uses a back arrow).
 * @param props.className
 * @param props.testId
 */
export function PanelCloseButton({ onClick, label, tooltip, icon, className, testId }: { onClick: () => void; label: string; tooltip?: string; icon?: React.ReactNode; className?: string; testId?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          data-testid={testId}
          className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground', className)}
        >
          {icon ?? <X className="size-4" aria-hidden />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" collisionPadding={8}>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}
