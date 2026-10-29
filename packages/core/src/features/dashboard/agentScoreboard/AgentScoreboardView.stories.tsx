import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { AgentScore, FlaggedTurn } from '@/services/evals/live/signals';
import { NextIntlClientProvider } from 'next-intl';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { AgentScoreboardView } from './AgentScoreboardView';
import { onlineLine } from './scoreboard';

/**
 * Live agents (ADR 0010), on made-up turns: three agents at Quick and
 * Standard, the analyst's Quick turns the ones refusing with the action
 * path there.
 */
const meta: Meta<typeof AgentScoreboardView> = {
  title: 'Evals/Live agents',
  component: AgentScoreboardView,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en">
        <div className="@container mx-auto max-w-6xl">
          <TitleBar title="Live agents" description="How each agent is doing on real turns: refusals with an action there, saves it claimed but never made, and turns where tools kept failing." />
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof AgentScoreboardView>;

const s = (agentSlug: string, level: string, over: Partial<AgentScore>): AgentScore => ({ agentSlug, level, turns: 0, toolCalls: 0, toolErrors: 0, searches: 0, toolFailures: 0, refusedWithAction: 0, claimedSave: 0, flagged: 0, loading: ['history'], lastAt: null, judged: 0, grounded: { passed: 0, of: 0 }, argsCorrect: { passed: 0, of: 0 }, unjustifiedRefusals: 0, ...over });

const scores: AgentScore[] = [
  s('pipeline-analyst', 'quick', { turns: 64, toolCalls: 141, toolErrors: 9, searches: 20, refusedWithAction: 5, claimedSave: 1, toolFailures: 1, flagged: 7, judged: 6, grounded: { passed: 4, of: 5 }, argsCorrect: { passed: 3, of: 3 }, unjustifiedRefusals: 2 }),
  s('pipeline-analyst', 'standard', { turns: 38, toolCalls: 162, toolErrors: 3, searches: 41, refusedWithAction: 1, flagged: 1, judged: 4, grounded: { passed: 4, of: 4 }, argsCorrect: { passed: 2, of: 2 } }),
  s('workspace-lead', 'quick', { turns: 51, toolCalls: 77, toolErrors: 2, searches: 9, claimedSave: 3, flagged: 3, judged: 3, grounded: { passed: 2, of: 2 } }),
  s('workspace-lead', 'standard', { turns: 22, toolCalls: 70, toolErrors: 1, searches: 14 }),
  s('revenue-lead', 'quick', { turns: 18, toolCalls: 30, toolErrors: 0, searches: 4, loading: ['core'] }),
  s('revenue-lead', 'standard', { turns: 47, toolCalls: 233, toolErrors: 6, searches: 30, toolFailures: 1, flagged: 1, loading: ['core'], judged: 5, grounded: { passed: 5, of: 5 }, argsCorrect: { passed: 3, of: 4 } }),
];

const at = (h: number) => new Date(Date.UTC(2026, 9, 28, h, 12));
const turns: FlaggedTurn[] = [
  { id: 9, agentSlug: 'pipeline-analyst', level: 'quick', toolLoading: 'history', flags: ['refusedWithAction'], toolCalls: 1, toolErrors: 0, conversationId: 311, traceId: '4f1c2a9be0d34c11', judge: null, createdAt: at(20) },
  { id: 8, agentSlug: 'workspace-lead', level: 'quick', toolLoading: 'history', flags: ['claimedSave'], toolCalls: 0, toolErrors: 0, conversationId: 307, traceId: '0b77e1d2aa914f0c', judge: null, createdAt: at(18) },
  { id: 7, agentSlug: 'revenue-lead', level: 'standard', toolLoading: 'core', flags: ['toolFailures'], toolCalls: 7, toolErrors: 3, conversationId: null, traceId: '9d0e33c4b1a24e77', judge: null, createdAt: at(16) },
  { id: 6, agentSlug: 'pipeline-analyst', level: 'quick', toolLoading: 'history', flags: ['refusedWithAction', 'claimedSave'], toolCalls: 2, toolErrors: 0, conversationId: 298, traceId: 'c2a4f8e19b7d4a03', judge: null, createdAt: at(14) },
  { id: 5, agentSlug: 'pipeline-analyst', level: 'standard', toolLoading: 'history', flags: [], toolCalls: 3, toolErrors: 0, conversationId: 291, traceId: '7e5b01aa3c6d4f92', judge: { grounded: false, argsCorrect: true, unjustifiedRefusal: false, completed: true, note: 'Says the Atlas pilot is in Negotiation; the deal record says Proposal.' }, createdAt: at(11) },
];

export const Board: Story = {
  args: { query: { days: 30, agent: null }, scores, turns, since: new Date(Date.UTC(2026, 8, 29)), timezone: 'America/Los_Angeles', online: onlineLine(null) },
};

export const OneAgent: Story = {
  args: { ...Board.args, query: { days: 30, agent: 'pipeline-analyst' }, turns: turns.filter(t => t.agentSlug === 'pipeline-analyst') },
};

export const Empty: Story = {
  args: { query: { days: 7, agent: null }, scores: [], turns: [], since: new Date(Date.UTC(2026, 9, 22)), timezone: 'America/Los_Angeles', online: onlineLine({ enabled: false, samplingPercentage: 5, evaluatorIds: ['Builtin.Correctness'] }) },
};
