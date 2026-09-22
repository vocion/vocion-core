import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { History, MoreHorizontal, PanelRightClose } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The rail's header after the 2026-09-15 polish pass: ONE hairline-separated
 * row, 48px tall — the workspace mark, its name as the title, then four equal
 * 32px ghost controls (New chat · conversations · collapse), every one
 * of them tooltipped.
 *
 * It was two lines before: a title with an underlined "All conversations"
 * link beneath it (which read as an error) and three unlabelled icons of
 * different sizes. The way out lives in the ⋯ menu now; the history icon
 * carries the job the link was doing.
 *
 * The story is the header's markup rather than a mounted `ChatDock`, which
 * would need the RPC client, the session and the SSE wire to render at all.
 * The rung control left the header for the composer's (+) menu on 2026-09-18.
 */

function GhostIcon({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" collisionPadding={8}>{label}</TooltipContent>
    </Tooltip>
  );
}

function RailHeader({ workspace = 'Revenue Team', width = 480 }: {
  workspace?: string;
  width?: number;
}) {
  return (
    <div style={{ width }} className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-brand-amber-tint text-[11px] font-semibold text-brand-amber-deep">
            {workspace.slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate text-sm font-semibold">{workspace}</span>
        </div>
        <GhostIcon label="Conversations"><History className="size-4" aria-hidden /></GhostIcon>
        <GhostIcon label="Chat options"><MoreHorizontal className="size-4" aria-hidden /></GhostIcon>
        <GhostIcon label="Collapse the conversation (⌘J)"><PanelRightClose className="size-4" aria-hidden /></GhostIcon>
      </div>
      <div className="h-24 bg-background" />
    </div>
  );
}

const meta: Meta<typeof RailHeader> = {
  title: 'Chat/RailHeader',
  component: RailHeader,
  parameters: { layout: 'centered' },
};

export default meta;

type Story = StoryObj<typeof RailHeader>;

/** The default rung: the chip is quiet, in muted foreground. */
export const Default: Story = { args: { width: 480 } };

/** The raised rung: the chip wears the accent, so it reads without hovering. */

/** A 320px rail — the chip is its icon alone and the tooltip has the words. */
export const NarrowRail: Story = { args: { width: 320 } };
