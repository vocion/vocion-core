import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { AgentRun, ChatMessage, IndexedDocument, TraceNode } from './types';
import { useState } from 'react';
import { AgentMessage } from './AgentMessage';
import { ChatComposer } from './ChatComposer';
import { UserMessage } from './UserMessage';

/**
 * The chat surface as a person reads it: their ask, the agent's turn — live
 * or landed — and the composer under it, in the transcript's own column
 * (`MessageList`). One live line per turn while it works; one quiet line that
 * says what the work was once it lands.
 *
 * Fixtures are fictional (Kestrel Capital, Northwind).
 * @param root0 - Story props.
 * @param root0.message - The agent's turn.
 * @param root0.streaming - The turn is still running.
 * @param root0.activity - What the turn says it is doing right now.
 */
function Transcript({ message, streaming = false, activity = null }: { message: ChatMessage; streaming?: boolean; activity?: string | null }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex min-h-[640px] w-[760px] max-w-full flex-col bg-background">
      <div className="flex flex-1 flex-col gap-8 px-6 pt-10 pb-6">
        <div className="mx-auto w-full max-w-3xl min-w-0 space-y-6">
          <UserMessage content="Where does the Kestrel Capital renewal stand? Draft a note to their CFO if it's stuck." />
          <AgentMessage
            agentName="Revenue"
            timestamp={Date.parse('2026-10-08T15:42:00.000Z')}
            message={message}
            streaming={streaming}
            activity={activity}
          />
        </div>
      </div>
      <ChatComposer
        value={value}
        onChange={setValue}
        onSubmit={() => setValue('')}
        streaming={streaming}
        onStop={() => {}}
        placeholder="Ask anything…"
        tagSearch={async () => []}
      />
    </div>
  );
}

const meta: Meta<typeof Transcript> = {
  title: 'Chat/Transcript',
  component: Transcript,
  parameters: { layout: 'fullscreen' },
};

export default meta;

type Story = StoryObj<typeof Transcript>;

const lead = { id: 'revenue-lead', kind: 'lead' as const, name: 'Revenue Lead' };

const thought: TraceNode = { id: 'r1', actor: lead, kind: 'reason', status: 'done', label: 'Reasoned', text: 'Confirm the renewal date and the order form status first, then check the last touch with the CFO.', anchor: 0 };
const deal: TraceNode = { id: 't1', actor: lead, kind: 'tool', status: 'done', label: 'Looked up records', detail: 'deal', tool: 'lookup_objects', result: '1 record', resultDetail: 'Kestrel Capital renewal · $184,000 · Contract sent', anchor: 0 };
const emails: TraceNode = { id: 's1', actor: lead, kind: 'search', status: 'done', label: 'Searched sources', detail: '“Kestrel order form”', result: '6 hits', tool: 'search_knowledge', anchor: 0 };
const notes: TraceNode = { id: 's2', actor: lead, kind: 'search', status: 'progress', label: 'Reading the call notes…', tool: 'read_call_notes', progress: 'call 3 of 5', labels: { running: 'Reading the call notes…', done: 'Read the call notes' }, anchor: 0 };
const draft: TraceNode = { id: 'd1', actor: lead, kind: 'draft', status: 'done', label: 'Drafted the note to Rhea Castillo', tool: 'create_artifact', anchor: 1 };

const documents: IndexedDocument[] = [
  { document_id: 'k1', semantic_identifier: 'Kestrel Capital — order form v3', link: '#', source_type: 'gmail', blurb: 'Legal has the redlines…', citationIndex: 1 },
  { document_id: 'k2', semantic_identifier: 'Kestrel QBR call notes, Sep 22', link: '#', source_type: 'web', blurb: '', citationIndex: 2 },
];

const FIRST = 'Kestrel renews **Nov 14**. Their order form has sat with their legal team since Sep 30 [1], and Rhea Castillo, their CFO, has not heard from us since the Sep 22 review [2].';
const REST = `## What is holding it

- Legal asked for a change to the **data-processing addendum**; nobody has answered.
- The renewal is priced at \`$184,000\`, flat on last year.
- No meeting is booked before the renewal date.

### The note

I drafted a short note to Rhea that answers the addendum question and proposes two times next week:

\`\`\`text
Subject: Kestrel renewal — the addendum, and next week
\`\`\`

It is waiting for you to approve before it sends.`;

const text = (t: string): AgentRun => ({ type: 'text', text: t });

/** Working: three steps landed, the fourth is reading — one line says so, with how far it has got and how long. */
export const LiveMidSteps: Story = {
  args: {
    streaming: true,
    activity: 'Reading the call notes… call 3 of 5',
    message: { role: 'assistant', content: '', runs: [], trace: [thought, deal, emails, notes] },
  },
};

/** Writing: the steps are behind it, folded; the one line sits under the words being written. */
export const LiveWriting: Story = {
  args: {
    streaming: true,
    activity: null,
    message: {
      role: 'assistant',
      content: FIRST,
      runs: [text(FIRST)],
      trace: [thought, deal, emails, { ...notes, status: 'done', label: 'Read the call notes', progress: undefined }],
      documents,
    },
  },
};

/** Landed: one quiet line that says what the work was, then the answer. */
export const Finished: Story = {
  args: {
    message: {
      id: 4121,
      role: 'assistant',
      content: `${FIRST}\n\n${REST}`,
      runs: [text(FIRST), text(REST)],
      trace: [thought, deal, emails, { ...notes, status: 'done', label: 'Read the call notes', progress: undefined }, draft],
      documents,
      model: { model: 'balanced', provider: 'anthropic', strength: 'balanced', thinking: 'off' },
    },
  },
};
