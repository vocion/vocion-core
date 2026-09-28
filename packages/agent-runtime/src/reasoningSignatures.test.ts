/**
 * Thinking signatures survive a tool loop on Bedrock.
 *
 * The first production turn on the Metacto runtime (Opus 5, 2026-09-28) died
 * on its second model call with `thinking.signature: Field required`, because
 * `@langchain/aws`'s event-stream path drops the signature Bedrock streams and
 * writes the thinking back without it. These tests drive the client seam the
 * fix sits on, with a fake client and the real library message shapes.
 */
import { describe, expect, it } from 'vitest';
import { noteSignatures, preserveReasoningSignatures, restoreSignatures } from './reasoningSignatures.js';

/**
 * A Converse stream for one turn that thought, then called a tool.
 * @param thought - The thinking text, streamed in two deltas.
 * @param signature - The signature streamed after it.
 */
async function* thinkingThenTool(thought: string, signature: string) {
  yield { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: thought.slice(0, 5) } } } };
  yield { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: thought.slice(5) } } } };
  yield { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature } } } };
  yield { contentBlockStop: { contentBlockIndex: 0 } };
  yield { contentBlockStart: { contentBlockIndex: 1, start: { toolUse: { toolUseId: 't1', name: 'lookup' } } } };
  yield { contentBlockStop: { contentBlockIndex: 1 } };
}

/**
 * The next request as the library builds it: the thinking comes back unsigned.
 * @param thought
 */
function nextRequest(thought: string) {
  return {
    input: {
      messages: [
        { role: 'user', content: [{ text: 'go' }] },
        { role: 'assistant', content: [{ reasoningContent: { reasoningText: { text: thought } } }, { toolUse: { toolUseId: 't1', name: 'lookup', input: {} } }] },
        { role: 'user', content: [{ toolResult: { toolUseId: 't1', content: [{ text: 'found' }] } }] },
      ],
    },
  };
}

describe('preserveReasoningSignatures', () => {
  it('hands the signature back on the request after a turn that thought', async () => {
    const thought = 'Let me look that up first.';
    const sent: unknown[] = [];
    const model = { client: { send: async (command: { input?: unknown }) => {
      sent.push(structuredClone(command.input));
      return { stream: thinkingThenTool(thought, 'sig-abc') };
    } } };
    preserveReasoningSignatures(model);

    const first = await model.client.send({ input: { messages: [{ role: 'user', content: [{ text: 'go' }] }] } }) as { stream: AsyncIterable<unknown> };
    for await (const _event of first.stream) {
      // Drained, as the library does.
    }
    await model.client.send(nextRequest(thought));

    const assistant = (sent[1] as { messages: Array<{ content: Array<{ reasoningContent?: { reasoningText: { signature?: string } } }> }> }).messages[1]!;

    expect(assistant.content[0]!.reasoningContent!.reasoningText.signature).toBe('sig-abc');
  });

  it('passes every stream event through unchanged', async () => {
    const seen = [];
    for await (const event of noteSignatures(thinkingThenTool('Some thinking here.', 's'), new Map())) {
      seen.push(event);
    }

    expect(seen).toHaveLength(6);
  });

  it('leaves a block that already carries a signature, and text it never saw, alone', () => {
    const memory = new Map([['known', 'sig-known']]);
    const input = { messages: [{ role: 'assistant', content: [
      { reasoningContent: { reasoningText: { text: 'known', signature: 'its-own' } } },
      { reasoningContent: { reasoningText: { text: 'never streamed' } } },
    ] }] };

    restoreSignatures(input, memory);

    expect(input.messages[0]!.content[0]!.reasoningContent.reasoningText.signature).toBe('its-own');
    expect('signature' in input.messages[0]!.content[1]!.reasoningContent.reasoningText).toBe(false);
  });

  it('is a no-op on something with no client', () => {
    const notAModel = { name: 'x' };

    expect(preserveReasoningSignatures(notAModel)).toBe(notAModel);
  });
});
