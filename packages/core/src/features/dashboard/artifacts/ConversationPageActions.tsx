'use client';

import { Minimize2, PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The full-page conversation's shell-bar controls: the artifacts this thread
 * produced, and the way back to the chat surface.
 *
 * The way back is only drawn where there is somewhere to go back TO. From
 * `md` up the conversation can sit in the rail beside a page, so "Collapse"
 * means something; on a phone the rail is a sheet over this same
 * conversation, and the control pointed at nothing — Chris, 2026-09-24, on
 * his phone: "Weird collapse icon? This is the only chat and page I can
 * see." Hidden below `md` in CSS, so the first paint is already right.
 * @param props - The controls' state and handlers.
 * @param props.artifactCount - How many artifacts the thread produced.
 * @param props.artifactsOpen - Whether one of them is already open beside the transcript.
 * @param props.onOpenArtifacts - Opens the newest artifact in the pane.
 * @param props.onBack - Returns to the chat surface.
 */
export function ConversationPageActions({ artifactCount, artifactsOpen, onOpenArtifacts, onBack }: {
  artifactCount: number;
  artifactsOpen: boolean;
  onOpenArtifacts: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-1" data-testid="conversation-page-actions">
      {!artifactsOpen && artifactCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onOpenArtifacts} className="gap-1.5" data-testid="conversation-artifacts">
          <PanelRight className="size-4" aria-hidden />
          <span className="hidden sm:inline">{`Artifacts · ${artifactCount}`}</span>
        </Button>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            aria-label="Back to the conversation"
            data-testid="conversation-collapse"
            className="hidden gap-1.5 md:inline-flex"
          >
            <Minimize2 className="size-4" aria-hidden />
            <span className="hidden lg:inline">Collapse</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" collisionPadding={8}>Back to the conversation</TooltipContent>
      </Tooltip>
    </div>
  );
}
