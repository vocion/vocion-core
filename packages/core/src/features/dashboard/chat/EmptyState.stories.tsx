import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { EmptyState } from './EmptyState';
import { WaitingNudge } from './WaitingNudge';

/**
 * The chat home: the workspace's lead says hello, with at most three quiet
 * starters and at most one soft nudge (founder, 2026-10-08: "Chat should
 * always start with a much warmer intro with very little on the chat
 * screen"). Pinned to the bottom of the pane ~28px above the box it invites
 * you to type in.
 *
 * Shown at the two rail widths that matter — the 320px minimum and a roomy
 * 680px — with the composer's ground under it so the spacing reads true.
 */
const SUGGESTIONS = [
  { label: 'What should I do?', prompt: 'What should I do?' },
  { label: 'What can you do?', prompt: 'What can you do?' },
  { label: 'What is in the review queue?', prompt: 'What is in the review queue?' },
  { label: 'Can we ship today?', prompt: 'Can we ship today?' },
  { label: 'How is the quarter tracking?', prompt: 'How is the quarter tracking?' },
];

function Pane({ width, ...props }: { width: number } & React.ComponentProps<typeof EmptyState>) {
  return (
    <div style={{ width }} className="flex h-[520px] flex-col overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex h-12 shrink-0 items-center border-b border-border px-3 text-sm font-semibold">Revenue Team</div>
      <EmptyState {...props} />
      {/* Stand-in for the composer, so the gap above it is the real one. */}
      <div className="mx-3 mb-3 h-[52px] shrink-0 rounded-2xl border border-border" aria-hidden />
    </div>
  );
}

const meta: Meta<typeof Pane> = {
  title: 'Chat/EmptyState',
  component: Pane,
  parameters: { layout: 'centered' },
  args: {
    speaker: 'Revenue',
    firstName: 'Sam',
    hour: 14,
    suggestions: SUGGESTIONS,
    onPick: () => {},
  },
};

export default meta;

type Story = StoryObj<typeof Pane>;

/** The narrowest rail: the headline wraps, the chips stack, nothing clips. */
export const NarrowRail: Story = { args: { width: 320 } };

/** A wide rail: three starters, the rest left out. */
export const WideRail: Story = { args: { width: 680 } };

/** Something waits on the person: one soft chip, never cards. */
export const WithNudge: Story = { args: { width: 480, nudge: <WaitingNudge count={3} /> } };

/** While the workspace's chips are being synthesized. */
export const Loading: Story = { args: { width: 480, suggestions: [], suggestionsLoading: true } };
