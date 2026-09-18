import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { TraceNode } from './types';
import { WorkTimeline } from './WorkTimeline';

/**
 * The rail's transparency layer (agent-chat-surface.md §9): what the person
 * sees while the agent works — rows appearing as tool calls start, reasoning
 * folded to one line — and the single "Worked it out" line the turn folds to
 * afterwards.
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

/** Mid-turn: reasoning folded with its first sentence, one done row, a delegate in flight with its specialist's row indented. */
export const Live: Story = {
  args: {
    runs: [],
    streaming: true,
    activity: 'Handing off to Pipeline Analyst…',
    trace: [reasoning, lookup, delegate, childSearch],
  },
};

/** The first seconds: only reasoning so far — "Thinking…" with the first sentence. */
export const LiveThinking: Story = {
  args: {
    runs: [],
    streaming: true,
    activity: 'Reasoning…',
    trace: [reasoning],
  },
};

/** A tool threw mid-turn: its row closes as an error with the message. */
export const LiveToolError: Story = {
  args: {
    runs: [],
    streaming: true,
    activity: null,
    trace: [reasoning, { ...lookup, id: 't2', status: 'error', label: 'Looked up records', result: 'HubSpot 429 — rate limited' }],
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
