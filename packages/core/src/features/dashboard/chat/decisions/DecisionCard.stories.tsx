import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { DecisionView } from '@/libs/decisions/decision';
import { useState } from 'react';
import { DecisionAnswerLine } from './DecisionAnswerLine';
import { DecisionCard } from './DecisionCard';
import { DecisionDock } from './DecisionDock';
import { DoneReceipts } from './DoneReceipts';

/**
 * THE DECISION CARD — one component for everything a person is asked to
 * decide, docked above the composer the way the Claude app asks: the
 * question, numbered options with the recommendation first and preselected,
 * "Something else", Skip, and a chevron that folds it away. Fully keyboard
 * driven: 1–9 pick, ↑↓ move, ↵ submits, Tab reaches "Something else", Esc
 * folds. The same component is a Needs you row (`variant="list"`).
 *
 * Every state is shown in light and dark. Fixtures are fictional (Northwind,
 * Kestrel Capital).
 */

const repo: DecisionView = {
  id: 41,
  kind: 'choice',
  question: 'Which repo should the factory build in?',
  body: 'Two repos match "Northwind". The request names neither.',
  options: [
    { id: 'api', label: 'Northwind API', consequence: 'Builds land in northwind/api; CI runs on every push.', recommended: true, hasEffect: true },
    { id: 'portal', label: 'Northwind Portal', consequence: 'Builds land in the customer portal; no CI yet.' },
    { id: 'docs', label: 'Northwind Docs', consequence: 'Builds land in the docs site.' },
  ],
  allowOther: true,
  multiple: false,
  state: 'open',
  agentSlug: 'product-manager',
  ownerUserId: 'usr-dana',
  conversationId: 392,
};

const question: DecisionView = { ...repo, id: 42, kind: 'question', question: 'What should the export be called?', body: 'It shows on the button and in the file name.', options: [] };
const approval: DecisionView = {
  ...repo,
  id: 43,
  kind: 'approval',
  question: 'Send the renewal follow-up to Kestrel Capital?',
  body: 'Drafted from yesterday\'s call. An email cannot be unsent.',
  options: [{ id: 'approve', label: 'Approve', consequence: 'Sends it now from your mailbox.', recommended: true }, { id: 'reject', label: 'Reject', consequence: 'Nothing is sent; the draft stays.' }],
  allowOther: false,
};
const several: DecisionView = { ...repo, id: 44, question: 'Which areas should this sprint cover?', body: null, multiple: true, options: [{ id: 'uploads', label: 'Uploads' }, { id: 'exports', label: 'Exports' }, { id: 'billing', label: 'Billing' }] };
const deadline: DecisionView = { ...repo, id: 45, deadline: { at: new Date(Date.now() + 2 * 86_400_000).toISOString(), defaultLabel: 'Northwind API' } };

/**
 * A card with its answers shown under it, as the surface receives them.
 * @param props - The story.
 * @param props.decision - The Decision.
 * @param props.variant - Dock or list row.
 * @param props.dark - Draw it in dark mode.
 * @param props.busy - The answer is on its way.
 * @param props.error - Why the last answer did not land.
 * @param props.total - How many wait in the queue.
 * @param props.collapsed - Folded away.
 */
function Card({ decision, variant = 'dock', dark = false, busy = false, error = null, total = 1, collapsed: startCollapsed = false }: { decision: DecisionView; variant?: 'dock' | 'list'; dark?: boolean; busy?: boolean; error?: string | null; total?: number; collapsed?: boolean }) {
  const [said, setSaid] = useState<string>('');
  const [collapsed, setCollapsed] = useState(startCollapsed);
  return (
    <div className={`${dark ? 'dark' : ''}`}>
      <div className="w-[640px] bg-background p-6 text-foreground">
        <DecisionCard
          decision={decision}
          agentName="Product manager"
          variant={variant}
          position={{ index: 0, total }}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          onAnswer={a => setSaid(JSON.stringify(a))}
          busy={busy}
          error={error}
          takeFocus={false}
        />
        {variant === 'dock' && (
          <div className="rounded-xl border border-border px-3 py-2.5 text-[14px] text-muted-foreground/70">Or reply directly…</div>
        )}
        {said && <pre className="mt-3 text-[11px] text-muted-foreground">{said}</pre>}
      </div>
    </div>
  );
}

const meta: Meta<typeof Card> = {
  title: 'Chat/DecisionCard',
  component: Card,
  parameters: { layout: 'centered' },
};

export default meta;

type Story = StoryObj<typeof Card>;

/** A choice: the recommendation first and preselected, each option's consequence. */
export const Choice: Story = { args: { decision: repo } };
export const ChoiceDark: Story = { args: { decision: repo, dark: true } };

/** A question with no options: answered in words. */
export const Question: Story = { args: { decision: question } };
export const QuestionDark: Story = { args: { decision: question, dark: true } };

/** An approval: Approve or Reject, words not offered. */
export const Approval: Story = { args: { decision: approval } };
export const ApprovalDark: Story = { args: { decision: approval, dark: true } };

/** Several may be chosen together: numbers toggle. */
export const Several: Story = { args: { decision: several } };
export const SeveralDark: Story = { args: { decision: several, dark: true } };

/** The first of three waiting: "1 of 3". */
export const Queue: Story = { args: { decision: repo, total: 3 } };
export const QueueDark: Story = { args: { decision: repo, total: 3, dark: true } };

/** Folded away (Esc): one line, opened again by a click. */
export const Collapsed: Story = { args: { decision: repo, total: 3, collapsed: true } };
export const CollapsedDark: Story = { args: { decision: repo, total: 3, collapsed: true, dark: true } };

/** With a deadline and the default that applies at it. */
export const Deadline: Story = { args: { decision: deadline } };
export const DeadlineDark: Story = { args: { decision: deadline, dark: true } };

/** The answer is on its way. */
export const Busy: Story = { args: { decision: repo, busy: true } };
export const BusyDark: Story = { args: { decision: repo, busy: true, dark: true } };

/** The last answer did not land, and the card says why. */
export const Refused: Story = { args: { decision: repo, error: 'Decision 41 was already answered in Slack.' } };
export const RefusedDark: Story = { args: { decision: repo, error: 'Decision 41 was already answered in Slack.', dark: true } };

/** The same component as a Needs you row. */
export const ListRow: Story = { args: { decision: repo, variant: 'list' } };
export const ListRowDark: Story = { args: { decision: repo, variant: 'list', dark: true } };

/**
 * After: the answer in the transcript — on the person's side, as a receipt,
 * never a bubble of words they did not type — and the Done line for what the
 * chosen option ran, with Undo only where its kind has one.
 * @param props - The story.
 * @param props.dark - Draw it in dark mode.
 */
function Answered({ dark = false }: { dark?: boolean }) {
  return (
    <div className={dark ? 'dark' : ''}>
      <div className="w-[640px] space-y-4 bg-background p-6 text-foreground">
        <DecisionAnswerLine answer={{ id: 41, question: 'Which repo should the factory build in?', line: 'Northwind API', kind: 'option', via: 'card' }} />
        <DecisionAnswerLine answer={{ id: 42, question: 'Ship it behind a flag?', line: 'Skipped', kind: 'skip', via: 'card' }} />
        <DoneReceipts receipts={[
          { runId: 7, actionId: 'objects.update_meta', label: 'Set the repo on Northwind uploads to northwind/api', undoable: true },
          { runId: 8, actionId: 'gmail.send', label: 'Sent the renewal follow-up to Kestrel Capital', undoable: false },
        ]}
        />
      </div>
    </div>
  );
}

export const AnswerAndDone: StoryObj<typeof Answered> = { render: () => <Answered /> };
export const AnswerAndDoneDark: StoryObj<typeof Answered> = { render: () => <Answered dark /> };

/** The dock with three waiting, as a surface mounts it. */
export const Dock: StoryObj<typeof DecisionDock> = {
  render: () => (
    <div className="w-[640px] bg-background p-6">
      <DecisionDock decisions={[repo, approval, question]} onAnswer={() => {}} agentName={() => 'Product manager'} />
    </div>
  ),
};
