import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { QueuedMessage } from './queueReducer';
import { useState } from 'react';
import { ChatComposer } from './ChatComposer';

/**
 * The composer after the 2026-09-15 polish pass: an input and ONE primary
 * action.
 *
 * Inside the box before it were the placeholder, a two-segment autonomy
 * toggle, a `?` and the send arrow — a per-conversation SETTING competing
 * with the one per-message action. The rung moved to the rail header; the `?`
 * stayed as a 32px ghost beside send, opening a collision-aware popover. The
 * focus state is a 1px ring in the ring token with a soft ground shift, not
 * the 4px amber halo it was.
 * @param root0 - Story props.
 * @param root0.initial - Text the box starts with.
 * @param root0.streaming - A turn is in flight: Enter queues, ⌘⏎ sends now.
 * @param root0.queued - Messages typed during the turn, waiting for it to land.
 */
function Composer({ initial = '', streaming = false, queued = [] }: { initial?: string; streaming?: boolean; queued?: QueuedMessage[] }) {
  const [value, setValue] = useState(initial);
  const [rows, setRows] = useState(queued);
  return (
    <div className="w-[480px] rounded-xl border border-border bg-background pt-10">
      <ChatComposer
        value={value}
        onChange={setValue}
        onSubmit={() => setValue('')}
        streaming={streaming}
        onStop={() => {}}
        onQueue={(text) => {
          setRows(prev => [...prev, { id: String(prev.length), text, at: Date.now() }]);
          setValue('');
        }}
        onDropQueued={id => setRows(prev => prev.filter(r => r.id !== id))}
        onEditQueued={(id) => {
          const row = rows.find(r => r.id === id);
          setRows(prev => prev.filter(r => r.id !== id));
          setValue(row?.text ?? '');
        }}
        queued={rows}
        placeholder="Ask anything…"
        tagSearch={async () => []}
      />
    </div>
  );
}

const meta: Meta<typeof Composer> = {
  title: 'Chat/ChatComposer',
  component: Composer,
  parameters: { layout: 'centered' },
};

export default meta;

type Story = StoryObj<typeof Composer>;

/** Nothing typed: send is disabled, and the box is the whole invitation. */
export const Empty: Story = { args: {} };

/** Typing: send fills with the accent — the one primary action on the surface. */
export const Typing: Story = { args: { initial: 'Where did the Acme renewal land?' } };

/**
 * Streaming, box empty: the one action is Stop — same 36px circle, same place.
 * The box stays live; it never locks (§12).
 */
export const Streaming: Story = { args: { streaming: true } };

/**
 * Streaming with something typed: the primary action becomes Queue (outlined
 * amber) and Stop steps back to a ghost beside it. Enter queues, ⌘⏎ sends now.
 */
export const StreamingWithText: Story = { args: { initial: 'and skip the ones already closed', streaming: true } };

/** Queued rows above the box: click one to edit it back, ✕ to drop it. */
export const Queued: Story = {
  args: {
    streaming: true,
    queued: [
      { id: 'a', text: 'and skip the ones already closed', at: 1 },
      { id: 'b', text: 'group the rest by owner', at: 2 },
    ],
  },
};
