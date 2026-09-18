import type { TurnOutcome } from './queueReducer';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { queueStorageKey } from './queueReducer';
import { useSendQueue } from './useSendQueue';

type BodyProps = {
  thread: number | null;
  streaming: boolean;
  outcome: TurnOutcome;
  onSend: (text: string) => void;
  startTurn: () => void;
};

/**
 * The part that actually holds the hook, so the harness can unmount just this
 * — what a rail collapse or a route change does to the real composer.
 * @param props - See `BodyProps`.
 * @param props.thread - Conversation the queue is keyed to.
 * @param props.streaming - True while a turn is in flight.
 * @param props.outcome - How the last turn ended.
 * @param props.onSend - Spy for what actually went out.
 * @param props.startTurn - Marks the next turn as running.
 */
function QueueBody({ thread, streaming, outcome, onSend, startTurn }: BodyProps) {
  const queue = useSendQueue({
    conversationId: thread,
    streaming,
    outcome,
    send: (text) => {
      onSend(text);
      // A real send starts the next turn — mirror that, so the queue drains one
      // message per completed turn rather than all at once.
      startTurn();
    },
  });

  return (
    <div>
      <button type="button" onClick={() => queue.enqueue('first')}>queue first</button>
      <button type="button" onClick={() => queue.enqueue('second')}>queue second</button>
      <button type="button" onClick={() => queue.drop(queue.items[0]?.id ?? '')}>drop head</button>
      <output data-testid="queued">{queue.items.map(i => i.text).join(',')}</output>
      <output data-testid="held">{String(queue.held)}</output>
    </div>
  );
}

/**
 * A stand-in for the chat surface: the harness owns the turn status the way
 * `useChatSession` does, so the test can drive "the turn landed" / "the turn
 * was stopped" / "the rail remounted" without a network.
 * @param props - Harness props.
 * @param props.onSend - Spy for what actually went out, in order.
 */
function Harness({ onSend }: { onSend: (text: string) => void }) {
  const [streaming, setStreaming] = useState(true);
  const [outcome, setOutcome] = useState<TurnOutcome>('running');
  const [thread, setThread] = useState<number | null>(7);
  const [mounted, setMounted] = useState(true);

  const startTurn = () => {
    setStreaming(true);
    setOutcome('running');
  };
  const end = (next: TurnOutcome) => {
    setStreaming(false);
    setOutcome(next);
  };

  return (
    <div>
      <button type="button" onClick={() => end('completed')}>land the turn</button>
      <button type="button" onClick={() => end('stopped')}>stop the turn</button>
      <button type="button" onClick={() => end('error')}>fail the turn</button>
      <button type="button" onClick={() => setThread(t => (t === 7 ? 8 : 7))}>switch thread</button>
      <button type="button" onClick={() => setMounted(m => !m)}>toggle mount</button>
      {mounted && (
        <QueueBody thread={thread} streaming={streaming} outcome={outcome} onSend={onSend} startTurn={startTurn} />
      )}
    </div>
  );
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('useSendQueue', () => {
  it('holds what was typed mid-turn, then sends it in order once the turn lands', async () => {
    const onSend = vi.fn();
    await render(<Harness onSend={onSend} />);

    await userEvent.click(page.getByRole('button', { name: 'queue first' }));
    await userEvent.click(page.getByRole('button', { name: 'queue second' }));

    await expect.element(page.getByTestId('queued')).toHaveTextContent('first,second');
    expect(onSend).not.toHaveBeenCalled();

    // Turn one lands: the head goes out and the next turn begins.
    await userEvent.click(page.getByRole('button', { name: 'land the turn' }));

    await expect.element(page.getByTestId('queued')).toHaveTextContent('second');
    expect(onSend.mock.calls.map(c => c[0])).toEqual(['first']);

    // Turn two lands: the tail follows, still in order.
    await userEvent.click(page.getByRole('button', { name: 'land the turn' }));

    await expect.element(page.getByTestId('queued')).toBeEmptyDOMElement();
    expect(onSend.mock.calls.map(c => c[0])).toEqual(['first', 'second']);
  });

  it('a stopped turn keeps the queue and says it was not sent', async () => {
    const onSend = vi.fn();
    await render(<Harness onSend={onSend} />);

    await userEvent.click(page.getByRole('button', { name: 'queue first' }));
    await userEvent.click(page.getByRole('button', { name: 'stop the turn' }));

    await expect.element(page.getByTestId('held')).toHaveTextContent('true');
    await expect.element(page.getByTestId('queued')).toHaveTextContent('first');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('a failed turn does the same — nobody loses their typing to an error', async () => {
    const onSend = vi.fn();
    await render(<Harness onSend={onSend} />);

    await userEvent.click(page.getByRole('button', { name: 'queue first' }));
    await userEvent.click(page.getByRole('button', { name: 'fail the turn' }));

    await expect.element(page.getByTestId('held')).toHaveTextContent('true');
    await expect.element(page.getByTestId('queued')).toHaveTextContent('first');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('survives an unmount — a rail resize, a collapse, a route change in the workspace', async () => {
    const onSend = vi.fn();
    await render(<Harness onSend={onSend} />);

    await userEvent.click(page.getByRole('button', { name: 'queue first' }));

    await expect.element(page.getByTestId('queued')).toHaveTextContent('first');
    expect(sessionStorage.getItem(queueStorageKey(7))).toContain('first');

    await userEvent.click(page.getByRole('button', { name: 'toggle mount' }));
    await userEvent.click(page.getByRole('button', { name: 'toggle mount' }));

    await expect.element(page.getByTestId('queued')).toHaveTextContent('first');
    // And it did not send itself on the way back — it waits for a turn to land.
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keys the queue per conversation, so two threads never cross', async () => {
    const onSend = vi.fn();
    await render(<Harness onSend={onSend} />);
    await userEvent.click(page.getByRole('button', { name: 'queue first' }));

    // Switching threads adopts the other thread's queue — here, an empty one.
    await userEvent.click(page.getByRole('button', { name: 'switch thread' }));

    await expect.element(page.getByTestId('queued')).toBeEmptyDOMElement();

    // …and coming back finds the first thread's queue where it was left.
    await userEvent.click(page.getByRole('button', { name: 'switch thread' }));

    await expect.element(page.getByTestId('queued')).toHaveTextContent('first');
  });

  it('dropping a row clears it from storage too', async () => {
    const onSend = vi.fn();
    await render(<Harness onSend={onSend} />);

    await userEvent.click(page.getByRole('button', { name: 'queue first' }));
    await userEvent.click(page.getByRole('button', { name: 'drop head' }));

    await expect.element(page.getByTestId('queued')).toBeEmptyDOMElement();
    expect(sessionStorage.getItem(queueStorageKey(7))).toBeNull();
  });
});
