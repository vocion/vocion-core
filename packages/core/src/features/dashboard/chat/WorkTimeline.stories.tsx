import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { TraceNode } from './types';
import { AgentMessage } from './AgentMessage';
import { WorkTimeline } from './WorkTimeline';

/**
 * The rail's transparency layer (agent-chat-surface.md §9): what the person
 * sees while the agent works — ONE live line per turn naming the step that is
 * running, with the count and the clock after it and the rows behind its
 * chevron — and the single headline line the turn folds to afterwards.
 */
const meta: Meta<typeof WorkTimeline> = {
  title: 'Chat/WorkTimeline',
  component: WorkTimeline,
  parameters: { layout: 'padded' },
  decorators: [Story => <div className="max-w-md"><Story /></div>],
};

export default meta;

type Story = StoryObj<typeof WorkTimeline>;

const lead = { id: 'revenue-director', kind: 'lead' as const, name: 'Revenue Director' };
const specialist = { id: 'pipeline-analyst', kind: 'specialist' as const, name: 'Pipeline Analyst' };

const reasoning: TraceNode = {
  id: 'r1',
  actor: lead,
  kind: 'reason',
  status: 'progress',
  label: 'Thinking',
  text: 'Chris wants to close Northwind as lost. First confirm the deal id and its live stage in HubSpot, then propose the update for approval rather than writing it directly.',
};

const lookup: TraceNode = {
  id: 't1',
  actor: lead,
  kind: 'tool',
  status: 'done',
  label: 'Looked up records',
  detail: 'deal',
  tool: 'lookup_objects',
  args: '{"type":"deal","query":"Northwind"}',
  result: '1 record',
  resultDetail: 'Northwind – Continuous AI (18k/mo retainer) · $216,000 · Proposal Sent',
};

const delegate: TraceNode = {
  id: 'd1',
  actor: lead,
  kind: 'delegate',
  status: 'start',
  label: 'Handing off to Pipeline Analyst…',
  detail: '“Confirm the live stage and the last touch on Northwind”',
};

const childSearch: TraceNode = {
  id: 'd1s1',
  parentId: 'd1',
  actor: specialist,
  kind: 'search',
  status: 'start',
  label: 'Searching sources…',
  detail: '“Northwind Devon governance”',
};

/** Live, one line — thinking only: nothing has run yet, so the line says so and opens onto the reasoning. */
export const LiveThinkingOnly: Story = {
  args: {
    runs: [],
    streaming: true,
    activity: null,
    elapsed: 4,
    trace: [reasoning],
  },
};

/** Live, one line — mid-steps: the running step names the line, "· 3 steps · 12s" after it, the rows behind the chevron. */
export const LiveMidSteps: Story = {
  args: {
    runs: [],
    streaming: true,
    activity: 'Handing off to Pipeline Analyst…',
    elapsed: 12,
    trace: [{ ...reasoning, status: 'done' }, lookup, delegate, childSearch],
  },
};

/**
 * Live, one line — prose after steps: the agent has written past its first
 * group, so that group is a quiet finished line and the live line sits under
 * the words being written.
 */
export const LiveProseAfterSteps: Story = {
  render: () => (
    <AgentMessage
      agentName="Revenue Director"
      streaming
      message={{
        role: 'assistant',
        content: 'Northwind is still at Proposal Sent, and Devon has not replied since the governance call.',
        runs: [{ type: 'text', text: 'Northwind is still at Proposal Sent, and Devon has not replied since the governance call.' }],
        trace: [
          { ...reasoning, status: 'done', anchor: 0 },
          { ...lookup, anchor: 0 },
          { ...delegate, status: 'done', label: 'Delegated to Pipeline Analyst', result: 'stage confirmed', anchor: 0 },
          { ...childSearch, status: 'done', label: 'Searched sources', result: '4 hits' },
        ],
      }}
    />
  ),
};

/** Live, one line — error: a failed step is never folded away; the group opens itself onto it. */
export const LiveError: Story = {
  args: {
    runs: [],
    streaming: true,
    activity: null,
    elapsed: 9,
    trace: [{ ...reasoning, status: 'done' }, { ...lookup, id: 't2', status: 'error', label: 'Looked up records', result: 'HubSpot 429 — rate limited' }],
  },
};

/** After the turn: one folded line; tap to open the curated trace. */
export const Folded: Story = {
  args: {
    runs: [],
    streaming: false,
    trace: [
      { ...reasoning, status: 'done' },
      lookup,
      { ...delegate, status: 'done', label: 'Delegated to Pipeline Analyst', result: 'stage confirmed' },
      { ...childSearch, status: 'done', label: 'Searched sources', result: '4 hits', citations: [{ sourceType: 'gmail', title: 'Re: Northwind governance — Devon', actorId: 'pipeline-analyst' }] },
    ],
    documents: [
      { document_id: 'g1', semantic_identifier: 'Re: Northwind governance — Devon', link: '#', source_type: 'gmail', blurb: 'Devon is still stalling on the governance clause…' },
    ],
  },
};
