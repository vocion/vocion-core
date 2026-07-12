/**
 * AgentCore Memory — conversation continuity for the loop (Phase 5).
 *
 * Opt-in twice over: the artifact needs VOCION_AGENTCORE_MEMORY_ID in
 * its environment AND the invocation must carry a `memory` session
 * (core sends one only when it has a persisted conversation). When
 * active, the loop loads its history from the Memory session instead of
 * the request payload — so core stops resending the whole conversation
 * every turn — and appends the new user/assistant turns after `done`.
 *
 * Postgres remains the system of record for the UI; Memory is the
 * LOOP's context source. Every failure here degrades silently to the
 * caller-supplied history — memory must never break chat.
 */

import process from 'node:process';

type Turn = { role: 'user' | 'assistant'; content: string };

const MAX_EVENTS = 40;

let clientPromise: Promise<import('@aws-sdk/client-bedrock-agentcore').BedrockAgentCoreClient> | null = null;

function memoryId(): string | undefined {
  return process.env.VOCION_AGENTCORE_MEMORY_ID || undefined;
}

async function client() {
  clientPromise ??= import('@aws-sdk/client-bedrock-agentcore').then(
    m => new m.BedrockAgentCoreClient({ region: process.env.AWS_REGION ?? 'us-west-2' }),
  );
  return clientPromise;
}

export function memoryEnabled(session?: { sessionId: string; actorId: string }): boolean {
  return Boolean(memoryId() && session?.sessionId && session.actorId);
}

/**
 * Load the session's conversational history, oldest first. Returns null
 * (→ caller falls back to payload history) on any failure.
 * @param session
 * @param session.sessionId
 * @param session.actorId
 */
export async function loadHistory(session: { sessionId: string; actorId: string }): Promise<Turn[] | null> {
  const id = memoryId();
  if (!id) {
    return null;
  }
  try {
    const { ListEventsCommand } = await import('@aws-sdk/client-bedrock-agentcore');
    const res = await (await client()).send(new ListEventsCommand({
      memoryId: id,
      sessionId: session.sessionId,
      actorId: session.actorId,
      includePayloads: true,
      maxResults: MAX_EVENTS,
    }));
    const turns: Turn[] = [];
    for (const event of res.events ?? []) {
      for (const p of event.payload ?? []) {
        const conv = (p as { conversational?: { role?: string; content?: { text?: string } } }).conversational;
        const text = conv?.content?.text;
        if (!text) {
          continue;
        }
        const role = conv?.role === 'ASSISTANT' ? 'assistant' : 'user';
        turns.push({ role, content: text });
      }
    }
    // ListEvents returns newest-first; the model wants oldest-first.
    return turns.reverse();
  } catch (err) {
    console.warn(`memory: loadHistory failed, falling back to payload history: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Append the completed turn (fire-and-forget from the caller's
 * perspective, but awaited internally so the runtime isn't frozen
 * mid-write by AgentCore's microVM suspend-on-idle).
 * @param session
 * @param session.sessionId
 * @param session.actorId
 * @param userMessage
 * @param assistantResponse
 */
export async function saveTurn(
  session: { sessionId: string; actorId: string },
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  const id = memoryId();
  if (!id || !assistantResponse) {
    return;
  }
  try {
    const { CreateEventCommand } = await import('@aws-sdk/client-bedrock-agentcore');
    await (await client()).send(new CreateEventCommand({
      memoryId: id,
      sessionId: session.sessionId,
      actorId: session.actorId,
      eventTimestamp: new Date(),
      payload: [
        { conversational: { role: 'USER', content: { text: userMessage.slice(0, 9000) } } },
        { conversational: { role: 'ASSISTANT', content: { text: assistantResponse.slice(0, 9000) } } },
      ],
    }));
  } catch (err) {
    console.warn(`memory: saveTurn failed (turn not persisted to Memory): ${(err as Error).message}`);
  }
}
