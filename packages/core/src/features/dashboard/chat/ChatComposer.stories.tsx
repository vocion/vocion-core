import type { Meta, StoryObj } from '@storybook/nextjs-vite';
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
 * @param root0.streaming - Render the Stop button instead of send.
 * @param root0.disabled - Lock the box (a turn is in flight).
 */
function Composer({ initial = '', streaming = false, disabled = false }: { initial?: string; streaming?: boolean; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="w-[480px] rounded-xl border border-border bg-background pt-10">
      <ChatComposer
        value={value}
        onChange={setValue}
        onSubmit={() => setValue('')}
        streaming={streaming}
        disabled={disabled}
        onStop={() => {}}
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

/** Streaming: send becomes Stop, same 36px circle, same place. */
export const Streaming: Story = { args: { initial: 'Where did the Acme renewal land?', streaming: true, disabled: true } };
