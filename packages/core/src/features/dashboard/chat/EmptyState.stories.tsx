import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/locales/en.json';
import { EmptyState } from './EmptyState';
import { WaitingNudge } from './WaitingNudge';

/**
 * The chat home: a mark and one warm line, the composer at the bottom, and
 * whitespace between (founder, 2026-10-08, after the Claude iOS app's empty
 * chat). One soft chip by the composer only when something waits.
 *
 * Shown at the 320px rail minimum and a roomy 680px, with the composer's
 * ground under it so the spacing reads true.
 */

function Pane({ width, ...props }: { width: number } & React.ComponentProps<typeof EmptyState>) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <div style={{ width }} className="flex h-[520px] flex-col overflow-hidden rounded-xl border border-border bg-background">
        <EmptyState {...props} />
        {/* Stand-in for the composer, so the gap above it is the real one. */}
        <div className="mx-3 mb-3 h-[52px] shrink-0 rounded-2xl border border-border" aria-hidden />
      </div>
    </NextIntlClientProvider>
  );
}

const meta: Meta<typeof Pane> = {
  title: 'Chat/EmptyState',
  component: Pane,
  parameters: { layout: 'centered' },
  args: { firstName: 'Sam', hour: 19, returning: false },
};

export default meta;

type Story = StoryObj<typeof Pane>;

/** The narrowest rail. */
export const NarrowRail: Story = { args: { width: 320 } };

/** A wide pane: still one mark and one line. */
export const WidePane: Story = { args: { width: 680 } };

/** Coming back after a while. */
export const WelcomeBack: Story = { args: { width: 480, returning: true } };

/** Something waits on the person: one soft chip by the composer, never cards. */
export const WithNudge: Story = { args: { width: 480, nudge: <WaitingNudge count={3} /> } };
