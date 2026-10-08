import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/locales/en.json';
import { RuleChangeEvidence } from './RuleChangeEvidence';

/**
 * What a rulebook compaction changes, and the evidence it was proposed on —
 * the block the learnings page and the Needs-you screen share. Each rule that
 * goes is listed with what it earned (how often it was asked for, where it
 * came from) and when it was last read and restated. The cast is fictional
 * (`libs/fixtures/realDataGuard.ts`).
 */
const meta: Meta<typeof RuleChangeEvidence> = {
  title: 'Learnings/RuleChangeEvidence',
  component: RuleChangeEvidence,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en" messages={messages}>
        <div className="mx-auto max-w-3xl">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof RuleChangeEvidence>;

const AS_OF = '2026-10-08T14:00:00.000Z';

/** Two rules that say the same thing, merged: the merged rule keeps all six times they were asked for. */
export const Merge: Story = {
  args: {
    kind: 'merge',
    stepName: 'crm-updates',
    replacedCount: 2,
    evidence: {
      reason: 'merged',
      asOf: AS_OF,
      rules: [
        { key: '/workspace/crm-updates/r1.md', text: 'Always cite the source line for every number you state about a Northwind deal.', occurrenceCount: 4, source: 'feedback:112', adoptedAt: '2026-08-02T10:00:00.000Z', lastUsedAt: '2026-10-07T16:20:00.000Z', lastReinforcedAt: '2026-09-30T09:00:00.000Z' },
        { key: '/workspace/crm-updates/r2.md', text: 'Never quote a Northwind deal amount without pointing at the record it came from.', occurrenceCount: 2, source: 'feedback:140', adoptedAt: '2026-09-11T10:00:00.000Z', lastUsedAt: '2026-10-07T16:20:00.000Z', lastReinforcedAt: null },
      ],
    },
  },
};

/** Rules nobody has read or restated for the workspace's window, retired in one decision. */
export const StaleRetirement: Story = {
  args: {
    kind: 'expire',
    stepName: 'outreach',
    replacedCount: 3,
    evidence: {
      reason: 'stale',
      staleDays: 60,
      asOf: AS_OF,
      rules: [
        { key: '/workspace/outreach/a.md', text: 'Mention the spring promotion to every Contoso Supply contact.', occurrenceCount: 1, source: 'learning-candidate', adoptedAt: '2026-04-02T10:00:00.000Z', lastUsedAt: null, lastReinforcedAt: null },
        { key: '/workspace/outreach/b.md', text: 'Copy the Acme account manager on renewal reminders.', occurrenceCount: 3, source: 'feedback:31', adoptedAt: '2026-03-15T10:00:00.000Z', lastUsedAt: '2026-06-20T08:00:00.000Z', lastReinforcedAt: '2026-05-01T08:00:00.000Z' },
        { key: '/workspace/outreach/c.md', text: 'Open with the Larkfield Systems case study for logistics prospects.', occurrenceCount: 1, source: 'feedback:44', adoptedAt: '2026-05-09T10:00:00.000Z', lastUsedAt: '2026-07-01T08:00:00.000Z', lastReinforcedAt: null },
      ],
    },
  },
};

/** A newer rule says the opposite: the older one goes, and the one that stays is shown beside it. */
export const Contradicted: Story = {
  args: {
    kind: 'expire',
    stepName: 'outreach',
    replacedCount: 1,
    evidence: {
      reason: 'contradicted',
      why: 'One asks for a compliment in the opening line, the other forbids it.',
      asOf: AS_OF,
      supersededBy: { key: '/workspace/outreach/new.md', text: 'Never open a Kestrel Capital email with a compliment; lead with the reason for writing.' },
      rules: [
        { key: '/workspace/outreach/old.md', text: 'Always open a Kestrel Capital email with a compliment about the fund.', occurrenceCount: 2, source: 'feedback:9', adoptedAt: '2026-06-01T10:00:00.000Z', lastUsedAt: '2026-10-07T16:20:00.000Z', lastReinforcedAt: '2026-06-03T10:00:00.000Z' },
      ],
    },
  },
};

/** A merge filed before evidence was kept: the count is all there is, and that is all it says. */
export const MergeWithoutEvidence: Story = {
  args: { kind: 'merge', stepName: 'global', replacedCount: 3, evidence: null },
};
