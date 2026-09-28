/**
 * Keep Bedrock's thinking signatures across a tool loop.
 *
 * Claude Sonnet 5 and Opus 5 think unless told not to, and when a model has
 * thought before a tool call, the next request must hand that thinking back
 * WITH the signature Bedrock streamed beside it — otherwise Bedrock refuses
 * the turn: `messages.3.content.0.thinking.signature: Field required`. That
 * was the first real turn on Metacto's production runtime (2026-09-28,
 * team-advisor on Opus 5), and it fails every turn that thinks and then calls
 * a tool.
 *
 * The signature is dropped by `@langchain/aws` (1.4.2), not by us. This loop
 * streams with LangGraph's v3 events, which makes the model take its
 * `_streamChatModelEvents` path, and that path's converter
 * (`utils/stream_events.js`) reads `reasoningContent.text` and ignores
 * `reasoningContent.signature`; its v1 message converter then writes the
 * reasoning back as `{ reasoningText: { text } }` with no signature. The chunk
 * path core's in-process loop uses keeps it, which is why this only showed up
 * on the container.
 *
 * So this sits on the one seam both directions pass through, the Bedrock
 * client's `send`: it notes each signature as the stream goes by, keyed by the
 * thinking text it signs, and puts it back on the same text in the next
 * request. Nothing else in either payload is touched. Delete this when the
 * library carries the signature itself — the test beside it will say so.
 */

type ReasoningText = { text?: string; signature?: string };
type ConverseContentBlock = { reasoningContent?: { reasoningText?: ReasoningText } };
type ConverseMessage = { role?: string; content?: ConverseContentBlock[] };
type StreamEvent = {
  contentBlockDelta?: { contentBlockIndex?: number; delta?: { reasoningContent?: { text?: string; signature?: string } } };
  contentBlockStop?: { contentBlockIndex?: number };
};
type SendableClient = { send: (command: { input?: unknown }, ...rest: unknown[]) => Promise<unknown> };

/** How many signatures one model instance remembers. A turn needs its own last few. */
const REMEMBERED = 500;

/**
 * Remember one signature, dropping the oldest past the limit.
 * @param memory - The model's signature memory.
 * @param text - The thinking text the signature signs.
 * @param signature - The signature Bedrock streamed.
 */
function remember(memory: Map<string, string>, text: string, signature: string): void {
  memory.delete(text);
  memory.set(text, signature);
  while (memory.size > REMEMBERED) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    memory.delete(oldest);
  }
}

/**
 * Put a remembered signature back on every assistant thinking block that lost
 * its own.
 * @param input - The Converse request input, mutated in place.
 * @param memory - The model's signature memory.
 */
export function restoreSignatures(input: unknown, memory: Map<string, string>): void {
  const messages = (input as { messages?: ConverseMessage[] } | undefined)?.messages;
  if (!Array.isArray(messages)) {
    return;
  }
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    for (const block of message.content ?? []) {
      const reasoning = block.reasoningContent?.reasoningText;
      if (reasoning && !reasoning.signature && typeof reasoning.text === 'string') {
        const signature = memory.get(reasoning.text);
        if (signature) {
          reasoning.signature = signature;
        }
      }
    }
  }
}

/**
 * Pass a Converse stream through unchanged, noting each thinking block's
 * signature against its text as the block closes.
 * @param source - The response stream.
 * @param memory - The model's signature memory.
 */
export async function* noteSignatures(source: AsyncIterable<StreamEvent>, memory: Map<string, string>): AsyncGenerator<StreamEvent> {
  const text = new Map<number, string>();
  const signature = new Map<number, string>();
  for await (const event of source) {
    const reasoning = event.contentBlockDelta?.delta?.reasoningContent;
    if (reasoning) {
      const index = event.contentBlockDelta?.contentBlockIndex ?? 0;
      if (typeof reasoning.text === 'string') {
        text.set(index, (text.get(index) ?? '') + reasoning.text);
      }
      if (typeof reasoning.signature === 'string') {
        signature.set(index, (signature.get(index) ?? '') + reasoning.signature);
      }
    }
    if (event.contentBlockStop) {
      const index = event.contentBlockStop.contentBlockIndex ?? 0;
      const said = text.get(index);
      const signed = signature.get(index);
      if (said && signed) {
        remember(memory, said, signed);
      }
      text.delete(index);
      signature.delete(index);
    }
    yield event;
  }
}

/**
 * Wrap a Bedrock chat model's client so thinking signatures survive the round
 * trip. Returns the same model.
 * @param model - A `ChatBedrockConverse` (or subclass) instance.
 */
export function preserveReasoningSignatures<T>(model: T): T {
  const client = (model as unknown as { client?: SendableClient }).client;
  if (!client || typeof client.send !== 'function') {
    return model;
  }
  const memory = new Map<string, string>();
  const send = client.send.bind(client);
  client.send = async (command, ...rest) => {
    restoreSignatures(command?.input, memory);
    const response = await send(command, ...rest) as { stream?: AsyncIterable<StreamEvent>; output?: { message?: ConverseMessage } };
    if (response?.stream) {
      response.stream = noteSignatures(response.stream, memory);
    }
    // A non-streamed answer carries whole blocks, signature included.
    for (const block of response?.output?.message?.content ?? []) {
      const reasoning = block.reasoningContent?.reasoningText;
      if (reasoning?.text && reasoning.signature) {
        remember(memory, reasoning.text, reasoning.signature);
      }
    }
    return response;
  };
  return model;
}
