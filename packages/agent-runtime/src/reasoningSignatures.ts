/**
 * Keep Bedrock's thinking signatures across a tool loop.
 *
 * Claude Sonnet 5 and Opus 5 think unless told not to, and when a model has
 * thought before a tool call, the next request must hand that thinking back
 * WITH the signature Bedrock streamed beside it — otherwise Bedrock refuses
 * the turn: `messages.1.content.0.thinking.signature: Field required`. That
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
 * client's `send`. As a response streams by it notes each thinking block's
 * signature, in order, against the id of every tool call that response made —
 * not against the thinking text, because Opus 5 streams its thinking with
 * EMPTY text and only a signature (seen live). The next request carries those
 * tool call ids in the assistant message it replays (all but any whose
 * arguments did not parse, which the library drops), and the signatures go
 * back on its thinking blocks in the same order. A response that calls no
 * tool is never replayed inside the loop, so it has nothing to restore.
 * Nothing else in either payload is touched. Delete this when the library
 * carries the signature itself.
 */

type ReasoningText = { text?: string; signature?: string };
type ConverseContentBlock = {
  reasoningContent?: { reasoningText?: ReasoningText };
  toolUse?: { toolUseId?: string };
};
type ConverseMessage = { role?: string; content?: ConverseContentBlock[] };
type StreamEvent = {
  contentBlockStart?: { contentBlockIndex?: number; start?: { toolUse?: { toolUseId?: string } } };
  contentBlockDelta?: { contentBlockIndex?: number; delta?: { reasoningContent?: { text?: string; signature?: string } } };
  contentBlockStop?: { contentBlockIndex?: number };
};
type SendableClient = { send: (command: { input?: unknown }, ...rest: unknown[]) => Promise<unknown> };

/** Signatures of one response's thinking blocks, in the order they streamed. */
type Signatures = string[];

/** How many responses one model instance remembers. A turn needs its own last few. */
const REMEMBERED = 500;

/**
 * Remember one response's signatures, dropping the oldest past the limit.
 * @param memory - The model's signature memory, keyed by tool call id.
 * @param toolUseId - One of the tool calls the response made.
 * @param signatures - Its thinking blocks' signatures, in order.
 */
function remember(memory: Map<string, Signatures>, toolUseId: string, signatures: Signatures): void {
  memory.delete(toolUseId);
  memory.set(toolUseId, signatures);
  while (memory.size > REMEMBERED) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    memory.delete(oldest);
  }
}

/**
 * Put the remembered signatures back on every replayed assistant message whose
 * thinking lost them.
 * @param input - The Converse request input, mutated in place.
 * @param memory - The model's signature memory.
 */
export function restoreSignatures(input: unknown, memory: Map<string, Signatures>): void {
  const messages = (input as { messages?: ConverseMessage[] } | undefined)?.messages;
  if (!Array.isArray(messages)) {
    return;
  }
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    const content = message.content ?? [];
    // Any of its tool calls will do: the library drops a call whose arguments
    // did not parse, so the first one streamed is not always the first one
    // replayed (seen live: a mission turn streamed three and replayed two).
    const signatures = content
      .map(b => b.toolUse?.toolUseId)
      .map(id => (id ? memory.get(id) : undefined))
      .find(Boolean);
    if (!signatures) {
      continue;
    }
    let next = 0;
    for (const block of content) {
      const reasoning = block.reasoningContent?.reasoningText;
      if (!reasoning) {
        continue;
      }
      const signature = signatures[next];
      next += 1;
      if (!reasoning.signature && signature) {
        reasoning.signature = signature;
      }
    }
  }
}

/**
 * Pass a Converse stream through unchanged, noting its thinking signatures
 * against every tool call it makes.
 * @param source - The response stream.
 * @param memory - The model's signature memory.
 */
export async function* noteSignatures(source: AsyncIterable<StreamEvent>, memory: Map<string, Signatures>): AsyncGenerator<StreamEvent> {
  const byBlock = new Map<number, string>();
  const order: number[] = [];
  const toolUseIds: string[] = [];
  for await (const event of source) {
    const started = event.contentBlockStart?.start?.toolUse?.toolUseId;
    if (started) {
      toolUseIds.push(started);
    }
    const reasoning = event.contentBlockDelta?.delta?.reasoningContent;
    if (reasoning) {
      const index = event.contentBlockDelta?.contentBlockIndex ?? 0;
      if (!order.includes(index)) {
        order.push(index);
      }
      if (typeof reasoning.signature === 'string') {
        byBlock.set(index, (byBlock.get(index) ?? '') + reasoning.signature);
      }
    }
    yield event;
  }
  if (order.length > 0) {
    const signatures = order.map(index => byBlock.get(index) ?? '');
    for (const id of toolUseIds) {
      remember(memory, id, signatures);
    }
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
  const memory = new Map<string, Signatures>();
  const send = client.send.bind(client);
  client.send = async (command, ...rest) => {
    restoreSignatures(command?.input, memory);
    const response = await send(command, ...rest) as { stream?: AsyncIterable<StreamEvent>; output?: { message?: ConverseMessage } };
    if (response?.stream) {
      response.stream = noteSignatures(response.stream, memory);
    }
    // A non-streamed answer carries whole blocks, signature included.
    const content = response?.output?.message?.content ?? [];
    const signatures = content.filter(b => b.reasoningContent?.reasoningText).map(b => b.reasoningContent?.reasoningText?.signature ?? '');
    if (signatures.length > 0) {
      for (const block of content) {
        if (block.toolUse?.toolUseId) {
          remember(memory, block.toolUse.toolUseId, signatures);
        }
      }
    }
    return response;
  };
  return model;
}
