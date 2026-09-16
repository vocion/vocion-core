import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { EmptyState } from './EmptyState';

/**
 * The chat home after the 2026-09-15 polish pass.
 *
 * It was an oversized two-tone headline ("Ask" in the foreground, the
 * workspace in amber) floating dead-centre in a tall column, as far from the
 * composer as the geometry allowed. Now: one size down, one colour, pinned to
 * the bottom of the pane ~28px above the box it invites you to type in, with
 * chips that are all one height and a ghost "More".
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
    greeting: { eyebrow: 'Demo Account', workspace: 'Revenue Team' },
    suggestions: SUGGESTIONS,
    onPick: () => {},
  },
};

export default meta;

type Story = StoryObj<typeof Pane>;

/** The narrowest rail: the headline wraps, the chips stack, nothing clips. */
export const NarrowRail: Story = { args: { width: 320 } };

/** A wide rail: two chips and a ghost "More" on one row. */
export const WideRail: Story = { args: { width: 680 } };

/** While the workspace's chips are being synthesized. */
export const Loading: Story = { args: { width: 480, suggestions: [], suggestionsLoading: true } };
