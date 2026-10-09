/**
 * THE TURN ENDS AT THE CARD, THROUGH A REAL deepagents LOOP.
 *
 * Production, 2026-10-09: the lead put an approval up, the turn ended 34 ms
 * later, and the model call the abort stopped stayed open for 102 s before it
 * settled as "Request was aborted". Here the graph, the tool node and the
 * middleware are real and only the model is written down, so what is asserted
 * is what a turn does: after a card is up, the model is never called again,
 * nothing is aborted, and the graph ends as an ordinary run.
 */
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { createDeepAgent } from 'deepagents';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHandOffMiddleware, HandOffGateCallback, HandOffGuard } from './handOff';

/** Asks for the card on its first step and answers on any later one; counts its calls. */
class CardThenTalkModel extends BaseChatModel {
  calls = 0;
  _llmType(): string {
    return 'card-then-talk';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    this.calls += 1;
    const message = this.calls === 1
      ? new AIMessage({
          content: 'Ana at Northwind is waiting on a reply about pricing.',
          tool_calls: [{ id: 'call_1', name: 'raise_card', args: { title: 'Reply to Ana (Northwind)' } }],
        })
      : new AIMessage({ content: 'Here is the draft again, in full, and three more paragraphs.' });
    return { generations: [{ text: '', message }] };
  }
}

function turn(armed: boolean) {
  const guard = new HandOffGuard();
  guard.arm(armed);
  const raiseCard = tool(async ({ title }) => {
    guard.handOff(title);
    return `Put "${title}" in front of the person as a decision. Your turn ends there.`;
  }, { name: 'raise_card', description: 'Put a decision in front of the person.', schema: z.object({ title: z.string() }) });
  const model = new CardThenTalkModel({});
  const graph = createDeepAgent({ model, tools: [raiseCard], middleware: [createHandOffMiddleware(guard)] });
  return { guard, model, graph };
}

describe('a card ends the turn before the next model call', () => {
  it('on a person\'s turn, the graph ends on its own: one model call, no abort', async () => {
    const { guard, model, graph } = turn(true);

    const out = await graph.invoke(
      { messages: [{ role: 'user', content: 'Which sales emails do I owe a reply?' }] } as never,
      { callbacks: [new HandOffGateCallback(guard)], signal: guard.signal } as never,
    );

    expect(model.calls).toBe(1);
    expect(guard.stopped).toBe(true);
    expect(guard.signal.aborted).toBe(false);
    expect(guard.stopError?.cards).toEqual(['Reply to Ana (Northwind)']);

    // The words before the card and the card's own result are the turn's last messages.
    const messages = (out as { messages: BaseMessage[] }).messages;
    const last = messages.at(-1)!;

    expect(last.getType()).toBe('tool');
    expect(String(last.content)).toContain('Reply to Ana (Northwind)');
  });

  it('a run nobody is waiting on carries on past the card', async () => {
    const { guard, model, graph } = turn(false);

    await graph.invoke(
      { messages: [{ role: 'user', content: 'Sweep the inbox for replies owed.' }] } as never,
      { callbacks: [new HandOffGateCallback(guard)], signal: guard.signal } as never,
    );

    expect(model.calls).toBe(2);
    expect(guard.stopped).toBe(false);
  });
});

describe('the abort stays the backstop', () => {
  it('a model call the middleware did not stop is still aborted, once', () => {
    const guard = new HandOffGuard();
    guard.arm(true);
    guard.handOff('Approve the send');

    expect(guard.endsBeforeModelCall()).toBe(true);
    expect(guard.signal.aborted).toBe(false);

    guard.beforeModelCall();

    expect(guard.signal.aborted).toBe(true);

    const first = guard.stopError;
    guard.beforeModelCall();

    expect(guard.stopError).toBe(first);
  });

  it('nothing ends before a card is up', () => {
    const guard = new HandOffGuard();
    guard.arm(true);

    expect(guard.endsBeforeModelCall()).toBe(false);
    expect(guard.stopped).toBe(false);
  });
});
