import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { GettingStartedState } from './GettingStartedChecklist';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import { GettingStartedChecklist } from './GettingStartedChecklist';

/**
 * "Getting started · N of 5" — the sidebar's checklist for a new shared
 * workspace, in the place the "Invite team members" box sat. Every tick is
 * read from the workspace (a system connected, an app or template added, an
 * agent hired, someone invited, the Org's own logo and colours); a step left opens the chat with the lead's
 * ask written, a step done opens where it lives. Static here (`live={false}`):
 * the state is the story's.
 * @param done
 */
function state(done: Array<GettingStartedState['steps'][number]['id']>): GettingStartedState {
  const steps = (['connect', 'app', 'hire', 'invite', 'brand'] as const).map(id => ({ id, done: done.includes(id) }));
  return { steps, done: steps.filter(s => s.done).length, total: steps.length };
}

function Sidebar({ initial, locale = 'en' }: { initial: GettingStartedState; locale?: 'en' | 'fr' }) {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en}>
      <div className="flex h-[360px] w-[232px] flex-col justify-end border-r border-border bg-sidebar py-2">
        <GettingStartedChecklist initial={initial} onDismiss={() => {}} live={false} />
        <div className="mx-2 flex h-9 items-center px-2 text-[13px] text-muted-foreground">Manage workspace</div>
      </div>
    </NextIntlClientProvider>
  );
}

const meta: Meta<typeof Sidebar> = {
  title: 'Dashboard/GettingStartedChecklist',
  component: Sidebar,
  parameters: { layout: 'centered' },
};

export default meta;

type Story = StoryObj<typeof Sidebar>;

/** A workspace's first minute: nothing done yet. */
export const NothingYet: Story = { args: { initial: state([]) } };

/** Half way: a system connected and an app added. */
export const HalfWay: Story = { args: { initial: state(['connect', 'app']) } };

/** One left: "Make it yours", the Org's logo and colours. */
export const OneLeft: Story = { args: { initial: state(['connect', 'app', 'hire', 'invite']) } };

/** In French. */
export const French: Story = { args: { initial: state(['app']), locale: 'fr' } };
