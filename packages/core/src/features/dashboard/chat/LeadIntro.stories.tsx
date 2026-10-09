import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import { LeadIntro, NoAgentsYet } from './LeadIntro';

/**
 * A new workspace opens on its lead, as lightly as any empty chat: the mark,
 * the lead's one-line hello, and one soft chip by the composer, "Set up this
 * workspace →", which starts the setup interview (2026-10-08).
 *
 * Shown at the two rail widths that matter, with the composer's ground under
 * it so the spacing reads true, in English and French; and the rare
 * no-agent state, in words for the person in the workspace.
 * @param root0
 * @param root0.width
 * @param root0.locale
 * @param root0.variant
 */
function Pane({ width, locale = 'en', variant = 'intro' }: { width: number; locale?: 'en' | 'fr'; variant?: 'intro' | 'none' }) {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en}>
      <div style={{ width }} className="flex h-[520px] flex-col overflow-hidden rounded-xl border border-border bg-background">
        {variant === 'intro'
          ? <LeadIntro firstName="Sam" onPick={() => {}} />
          : <NoAgentsYet />}
        {/* Stand-in for the composer, so the gap above it is the real one. */}
        <div className="mx-3 mb-3 h-[52px] shrink-0 rounded-2xl border border-border" aria-hidden />
      </div>
    </NextIntlClientProvider>
  );
}

const meta: Meta<typeof Pane> = {
  title: 'Chat/LeadIntro',
  component: Pane,
  parameters: { layout: 'centered' },
};

export default meta;

type Story = StoryObj<typeof Pane>;

/** The full-page chat on a workspace's first day. */
export const Wide: Story = { args: { width: 720 } };

/** The narrowest rail: the sentence wraps, the starters stack, nothing clips. */
export const NarrowRail: Story = { args: { width: 320 } };

/** In French. */
export const French: Story = { args: { width: 720, locale: 'fr' } };

/** No agent at all — one could not be seeded, or every one was retired. */
export const NoAgents: Story = { args: { width: 520, variant: 'none' } };
