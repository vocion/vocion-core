import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { RecommendedAction } from '../types';
import { NextIntlClientProvider } from 'next-intl';
import { NORTHWIND_FIELDS } from '@/features/branding/northwind.fixture';
import en from '@/locales/en.json';
import { BrandPreviewCard } from './BrandPreviewCard';

/**
 * "Make it yours" — the workspace lead's `propose_brand`, as it lands in
 * chat: the brand read off the company's site on a sidebar and a sign-in
 * page, and three typed choices. 1 / 2 / 3 pick, Enter takes the
 * preselected "Use this brand", Esc skips. Pressing it here calls nothing.
 */

const rec: RecommendedAction = {
  id: 'card_story_brand',
  kind: 'brand',
  actionId: 'org.brand_apply',
  input: { ...NORTHWIND_FIELDS, logos: { wordmark: NORTHWIND_FIELDS.logos.wordmark, mark: NORTHWIND_FIELDS.logos.mark } },
  label: 'Make it yours: Northwind',
  body: 'Read from northwind.example (82% sure).',
  href: '/dashboard/brand?draft=story',
  hrefLabel: 'Adjust',
  agentSlug: 'workspace-lead',
  fields: [{ label: 'Note', value: 'Their favicon is an .ico, which the app can\'t keep, so the browser tab keeps Vocion\'s mark until a square SVG or PNG is uploaded.' }],
  state: 'proposed',
};

function Card({ theme, decided }: { theme: 'light' | 'dark'; decided?: boolean }) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <div className={`${theme === 'dark' ? 'dark' : ''} w-[640px] rounded-xl bg-background p-6 text-foreground`}>
        <p className="text-[15px]">Here is Northwind on the app — the sidebar and sign-in, in your colours.</p>
        <BrandPreviewCard rec={decided ? { ...rec, decision: { action: 'reject', at: '2026-10-08T12:00:00.000Z' } } : rec} previewTheme={theme} />
      </div>
    </NextIntlClientProvider>
  );
}

const meta: Meta<typeof Card> = {
  title: 'Chat/Cards/BrandPreviewCard',
  component: Card,
  parameters: { layout: 'centered' },
};

export default meta;

type Story = StoryObj<typeof Card>;

export const Light: Story = { args: { theme: 'light' } };
export const Dark: Story = { args: { theme: 'dark' }, parameters: { backgrounds: { default: 'dark' } } };

/** Reloaded after Skip: the outcome, and the way to Brand settings. */
export const Skipped: Story = { args: { theme: 'light', decided: true } };
