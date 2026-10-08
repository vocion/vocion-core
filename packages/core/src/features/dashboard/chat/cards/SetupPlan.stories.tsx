import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { RecommendedAction } from '../types';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/locales/en.json';
import { SetupCard } from './SetupCard';
import { SetupPlan } from './SetupPlan';

/**
 * The workspace lead's setup plan (`propose_setup`) as it lands under its
 * reply: one column, in the order the work would happen, each step one press.
 * A connection is the ordinary connect card in its place. Unpressed here — a
 * press files and approves the step through the review service and the card
 * then reads Done, with Undo and a link to where the result lives.
 */
const PLAN: RecommendedAction[] = [
  { id: 'card_s1', kind: 'setup', actionId: 'app.install', input: { app: 'software-factory' }, label: 'Add Software Factory', actionLabel: 'Add', body: 'Customer requests become fixes the asker hears about.', href: '/dashboard/p/products', hrefLabel: 'Open Software Factory', state: 'proposed' },
  { id: 'card_s2', kind: 'link', actionId: '', input: {}, label: 'Connect GitHub', href: '/dashboard/connectors?add=github', hrefLabel: 'Connect GitHub', secondaryHref: '/dashboard/connectors?add=github&paste=1', secondaryHrefLabel: 'Paste a token', state: 'proposed' },
  { id: 'card_s3', kind: 'setup', actionId: 'team.hire_agent', input: { slug: 'reporting-analyst', dailyCentsLimit: 10000, reason: 'Owns the Friday report on open tickets.' }, label: 'Hire Reporting Analyst', actionLabel: 'Hire', body: 'Owns the Friday report on open tickets.', fields: [{ label: 'Daily cap', value: '$100' }], state: 'proposed' },
  { id: 'card_s4', kind: 'setup', actionId: 'members.invite', input: { emails: ['ana@northwind.example'], role: 'member' }, label: 'Invite ana@northwind.example', actionLabel: 'Invite', body: 'So Ana sees the Friday report.', href: '/dashboard/members', hrefLabel: 'Open Members', state: 'proposed' },
];

function Reply({ width, recs }: { width: number; recs: RecommendedAction[] }) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <div style={{ width }} className="rounded-xl bg-background p-4">
        <p className="text-sm">Here is a plan for Northwind Support. Press each step when you are ready; every one can be undone.</p>
        <SetupPlan recs={recs} />
      </div>
    </NextIntlClientProvider>
  );
}

const meta: Meta<typeof Reply> = {
  title: 'Chat/SetupPlan',
  component: Reply,
  parameters: { layout: 'centered' },
  args: { recs: PLAN },
};

export default meta;

type Story = StoryObj<typeof Reply>;

/** The full-page chat. */
export const Wide: Story = { args: { width: 680 } };

/** The narrowest rail. */
export const NarrowRail: Story = { args: { width: 340 } };

/** One step on its own, as a single card under a reply. */
export const OneStep: StoryObj<typeof SetupCard> = {
  render: () => (
    <NextIntlClientProvider locale="en" messages={en}>
      <div style={{ width: 520 }}>
        <SetupCard rec={PLAN[0]!} />
      </div>
    </NextIntlClientProvider>
  ),
};
