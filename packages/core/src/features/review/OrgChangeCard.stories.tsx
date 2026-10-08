import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { ReviewCardRun } from './ReviewSurface';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/locales/en.json';
import { ReviewSurface } from './ReviewSurface';

/**
 * The weekly org review's proposals (`org.change`), on the same review shell
 * every other action uses: the change leads, the evidence follows line by
 * line — each one a link to where a person can check it — and the date the
 * evidence was read rides as a badge. One story per kind of change. The cast
 * is fictional (`libs/fixtures/realDataGuard.ts`).
 */
const meta: Meta<typeof ReviewSurface> = {
  title: 'Review/Org change',
  component: ReviewSurface,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en" messages={messages}>
        <div className="@container mx-auto max-w-5xl">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof ReviewSurface>;

const CRUMBS = [
  { label: 'Workspace', href: '/dashboard' },
  { label: 'Needs you', href: '/dashboard/inbox' },
  { label: 'Approvals' },
];

/**
 * An org change run, pending, with the card its presenter would build.
 * @param id - The run id.
 * @param card - The card.
 * @param proposal - What the review said about it.
 * @param proposal.confidence - How sure.
 * @param proposal.reason - Its case.
 */
function orgChange(id: number, card: ReviewCardRun['card'], proposal: { confidence: number; reason: string }): ReviewCardRun {
  return {
    id,
    actionId: 'org.change',
    status: 'pending',
    invokedBy: 'agent:org-review',
    input: {},
    proposal: { confidence: proposal.confidence, rationale: proposal.reason, suggestedDecision: 'approve', suggestedDecisionReason: card.headline ?? card.title },
    card,
  };
}

const BADGES = (kind: string) => [{ label: kind }, { label: 'Reversible' }, { label: 'Evidence as of 2026-10-08' }];

/** An agent nobody has used in six weeks. */
export const RetireAnAgent: Story = {
  args: {
    crumbs: CRUMBS,
    run: orgChange(901, {
      title: 'Retire Kestrel Scout — no runs in 41 days',
      system: 'Org review',
      headline: 'Retire Kestrel Scout — no runs in 41 days',
      badges: BADGES('Retire an agent'),
      confidenceSubject: 'This change is right',
      summary: 'Kestrel Scout has not run since 2026-08-28, past this workspace\'s 14-day idle window. Retiring it keeps the roster honest; Undo brings it back as it was.',
      fields: [
        { label: 'Agent', value: 'Kestrel Scout (kestrel-scout)', href: '/dashboard/agents/kestrel-scout' },
        { label: 'Last run', value: '2026-08-28 (41 days ago)', href: '/dashboard/team-report/kestrel-scout' },
        { label: 'On the team since', value: '2026-06-02', href: '/dashboard/agents/kestrel-scout' },
        { label: 'Work in the window', value: '0 turns, 0 runs, 0 decided proposals' },
      ],
      links: [{ label: 'Team report', href: '/dashboard/team-report' }],
      nextAction: 'Retiring makes the agent inactive and holds it there across workspace applies: it is no longer routed to and takes no turns. Undo brings it back as it was.',
      verbs: { approve: 'Retire', reject: 'Decline' },
    }, { confidence: 0.86, reason: 'It has never been needed since the Kestrel Capital pilot ended.' }),
  },
};

/** Spend buying work people turn down: halve the allowance while the rules catch up. */
export const ReScopeABudget: Story = {
  args: {
    crumbs: CRUMBS,
    run: orgChange(902, {
      title: 'Halve Deal Desk\'s daily cap to $50.00',
      system: 'Org review',
      headline: 'Halve Deal Desk\'s daily cap to $50.00',
      badges: BADGES('Re-scope a budget'),
      confidenceSubject: 'This change is right',
      summary: 'Deal Desk spent $184.20 in 30 days and people agreed with only 31% of 16 recommendations. A smaller allowance limits the cost while its rules catch up.',
      fields: [
        { label: 'Agent', value: 'deal-desk', href: '/dashboard/agents/deal-desk' },
        { label: 'Daily cap', value: '$100.00 → $50.00' },
        { label: 'Spend, last 30 days', value: '$184.20', href: '/dashboard/team-report/deal-desk' },
        { label: 'Today', value: '$12.40 of $100.00' },
        { label: 'Agrees with you', value: '31% of 16 decided recommendations', href: '/dashboard/inbox?tab=decided&kind=proposal&agents=deal-desk' },
      ],
      links: [{ label: 'Team report', href: '/dashboard/team-report' }],
      nextAction: 'Adjusting sets the agent\'s daily cap to $50.00, soft and hard. Undo writes the previous caps back.',
      verbs: { approve: 'Adjust', reject: 'Decline' },
    }, { confidence: 0.71, reason: 'Most of its Northwind updates were turned down as premature.' }),
  },
};

/** A pattern people keep correcting, made a standing rule. */
export const AdoptAStandingRule: Story = {
  args: {
    crumbs: CRUMBS,
    run: orgChange(903, {
      title: 'Adopt: keep a first-touch email to Contoso Supply under 120 words',
      system: 'Org review',
      headline: 'Adopt: keep a first-touch email under 120 words',
      badges: BADGES('Adopt a standing rule'),
      confidenceSubject: 'This change is right',
      summary: 'Four of six first-touch sends were turned down this month, three of them as too long.',
      fields: [
        { label: 'Rule', value: 'Keep a first-touch email under 120 words and ask one question.' },
        { label: 'Agent', value: 'outreach-writer', href: '/dashboard/agents/outreach-writer' },
        { label: 'Turned down', value: '4 of 6 gmail.send proposals in 30 days', href: '/dashboard/inbox?tab=decided&kind=proposal&agents=outreach-writer&actionKind=gmail.send' },
        { label: 'Latest reason given', value: 'gmail.send: too long for a first touch — cut it to the question.' },
      ],
      links: [{ label: 'Team report', href: '/dashboard/team-report' }],
      nextAction: 'Adopting files the rule in the agent\'s learning step; it reads it before its next piece of work. A rule already on file raises its count instead. Undo removes it.',
      verbs: { approve: 'Adopt', reject: 'Decline' },
    }, { confidence: 0.78, reason: 'The same correction, three times.' }),
  },
};

/** A team behind on its measure, with a catalog role it has not hired. */
export const HireARole: Story = {
  args: {
    crumbs: CRUMBS,
    run: orgChange(904, {
      title: 'Hire an SEO Specialist for Revenue Ops',
      system: 'Org review',
      headline: 'Hire an SEO Specialist for Revenue Ops at $20.00 a day',
      badges: BADGES('Hire a role'),
      confidenceSubject: 'This change is right',
      summary: 'Revenue Ops is at 20% of its qualified-referrals target, and nobody on the team works search demand.',
      fields: [
        { label: 'Role', value: 'SEO Specialist — finds the search demand a team is missing', href: '/dashboard/hire/seo-specialist' },
        { label: 'Allowance', value: '$20.00 a day, soft and hard' },
        { label: 'Qualified referrals', value: '2 referrals of 10 referrals (20%) over 30d — human-confirmed', href: '/dashboard/team-report' },
        { label: 'On the team', value: 'deal-desk, outreach-writer', href: '/dashboard/teams' },
      ],
      links: [{ label: 'Team report', href: '/dashboard/team-report' }],
      nextAction: 'Hiring adds SEO Specialist from the catalog at $20.00 a day. Undo removes it, its budget and any team the hire created.',
      verbs: { approve: 'Hire', reject: 'Decline' },
    }, { confidence: 0.64, reason: 'Search is the channel the measure depends on and nobody covers it.' }),
  },
};
