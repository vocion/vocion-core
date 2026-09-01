/**
 * Turn-level record/replay for the hosted demo sandbox.
 *
 * The per-call LLM cache (libs/llm/replayCache) is too fragile for whole
 * agent turns: prompts embed timestamps and fresh DB state, so hashes
 * drift between record time and replay time. This layer keys on what a
 * visitor actually controls — (agent slug, normalized user message) —
 * and replays the ENTIRE recorded turn: every emitted event (tool steps,
 * documents, status) in order, then the final response. Immune to prompt
 * drift, and it never runs the loop at all in replay mode.
 *
 * Fixtures: demo/turns/<sha256>.json (VOCION_LLM_CACHE_DIR/../turns).
 */
import type { AgentEvent } from './types';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { hashKey, llmMode, REPLAY_FALLBACK_TEXT, resolveDemoPath } from '@/libs/llm/replay';

type TurnResult = {
  response: string;
  traceId: string;
  toolCalls: Array<{ tool: string; input: Record<string, unknown>; output: string }>;
};

type StoredTurn = {
  agentSlug: string;
  message: string;
  response: string;
  toolCalls: TurnResult['toolCalls'];
  events: AgentEvent[];
};

function turnsDir(): string {
  const base = resolveDemoPath(process.env.VOCION_LLM_CACHE_DIR ?? join('demo', 'llm-cache'));
  return join(base, '..', 'turns');
}

function normalize(message: string): string {
  return message.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?\s]+$/, '').trim();
}

function turnKey(agentSlug: string, message: string): string {
  return hashKey('turn', agentSlug, normalize(message));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * Replay a recorded turn if one exists (replay mode only). Returns null when
 * the caller should run the real loop (live/record modes), or a resolved
 * result after re-emitting the recorded event stream. Unrecorded messages
 * get the honest fallback instead of a provider call.
 * @param opts - agent slug + user message (the replay key)
 * @param opts.agentSlug
 * @param opts.message
 * @param emit - event sink; recorded events are re-emitted through it
 */
export async function maybeReplayTurn(
  opts: { agentSlug: string; message: string },
  emit: (event: AgentEvent) => void,
): Promise<TurnResult | null> {
  if (llmMode() !== 'replay') {
    return null;
  }
  const key = turnKey(opts.agentSlug, opts.message);
  const file = join(turnsDir(), `${key}.json`);
  if (existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as StoredTurn;
      const traceId = `demo-replay-${key.slice(0, 12)}`;
      for (const event of stored.events) {
        emit(event);
        // A small cadence keeps the SSE surface feeling live.
        await sleep(120);
      }
      emit({ type: 'done', response: stored.response, traceId });
      return {
        response: stored.response,
        traceId,
        toolCalls: stored.toolCalls,
      };
    } catch {
      // fall through to the fallback below
    }
  }
  const missTrace = `demo-replay-miss-${key.slice(0, 12)}`;
  emit({ type: 'response_delta', delta: REPLAY_FALLBACK_TEXT } as AgentEvent);
  emit({ type: 'done', response: REPLAY_FALLBACK_TEXT, traceId: missTrace } as AgentEvent);
  return {
    response: REPLAY_FALLBACK_TEXT,
    traceId: missTrace,
    toolCalls: [],
  };
}

/**
 * Persist a completed live turn as a replay fixture (record mode only).
 * @param opts
 * @param opts.agentSlug
 * @param opts.message
 * @param events
 * @param result
 */
export function recordTurn(
  opts: { agentSlug: string; message: string },
  events: AgentEvent[],
  result: TurnResult,
): void {
  if (llmMode() !== 'record') {
    return;
  }
  mkdirSync(turnsDir(), { recursive: true });
  const stored: StoredTurn = {
    agentSlug: opts.agentSlug,
    message: opts.message,
    response: result.response,
    toolCalls: result.toolCalls,
    // The 'done' marker is re-synthesized at replay; keep it out of the
    // stored stream so it is never emitted twice. Cap defensively.
    events: events.filter(e => e.type !== 'done').slice(0, 400),
  };
  writeFileSync(join(turnsDir(), `${turnKey(opts.agentSlug, opts.message)}.json`), JSON.stringify(stored));
}
