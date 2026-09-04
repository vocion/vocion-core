/**
 * The loop — a definition-driven port of vocion-core's
 * `services/agents/harness.ts` + the streaming section of
 * `runAgentDeep`. Same deepagents engine, same event semantics; the
 * difference is that everything DB-derived (agent row, playbooks,
 * learnings, tool scope) arrives in the invocation payload instead of
 * being read here. The artifact holds no state between invocations
 * beyond a small compiled-graph cache keyed by definition hash.
 */

import type { SubAgent } from 'deepagents';
import type { AgentEvent, InvocationRequest } from './contract.js';
import { createHash } from 'node:crypto';
import { createDeepAgent, StateBackend } from 'deepagents';
import { loadHistory, memoryEnabled, retrieveLongTerm, saveTurn } from './memory.js';
import { buildChatModel } from './model.js';
import { buildTransportTools } from './tools.js';
import { createRuntimeTrace } from './tracing.js';

/* ------------------------------------------------------------------ */
/* Graph cache — keyed by a hash of everything that shapes the graph   */
/* ------------------------------------------------------------------ */

const GRAPH_CACHE_LIMIT = 16;
/**
 * One cached agent graph, plus the two refs an invocation swaps out before
 * running it.
 *
 * The graph is expensive to build and identical for every request with the
 * same definition, so it is reused; anything that is per-request lives behind
 * a ref the graph reads through instead of being baked in. `awsRef` is the
 * important one: it holds the caller's temporary Bedrock credential, so it
 * MUST be replaced on every invocation and MUST NOT be part of what the graph
 * closed over at build time.
 */
type GraphEntry = {
  graph: ReturnType<typeof createDeepAgent>;
  emitRef: { emit: (e: AgentEvent) => void };
  awsRef: { session: InvocationRequest['aws'] };
};

const graphCache = new Map<string, GraphEntry>();

export function definitionHash(req: InvocationRequest): string {
  return createHash('sha256')
    .update(JSON.stringify({
      agent: req.agent,
      catalog: req.tools.catalog,
      endpoint: req.tools.endpoint,
      hasPlaybooks: Object.keys(req.files ?? {}).some(p => p.startsWith('/playbooks/') || p.startsWith('/skills/')),
      // Two orgs can hold identical agent definitions — same slug, same
      // prompt, same tool catalog — and before the graph carried a
      // credential that was harmless. It no longer is, so the cache is
      // partitioned by org as well. The credential itself is deliberately
      // NOT hashed: it is minted per invocation, so hashing it would miss
      // the cache every single time.
      orgId: req.trace?.orgId,
      // Whether a credential is present, not what it is. The model client
      // decides at build time whether to override its credential chain at
      // all, so an org that stores an AWS key after its first run needs a
      // rebuilt graph rather than a stale one that ignores the key.
      hasAwsSession: Boolean(req.aws),
    }))
    .digest('hex');
}

async function getGraph(req: InvocationRequest): Promise<GraphEntry> {
  const key = definitionHash(req);
  const cached = graphCache.get(key);
  if (cached) {
    graphCache.delete(key);
    graphCache.set(key, cached);
    return cached;
  }

  // Tools close over a mutable emit ref (same pattern as core's
  // harness): the graph is cache-shared, the emit is per-request.
  // NOTE the claim is part of the cache key via endpoint+catalog…
  // it is NOT — claims rotate per request. So the transport tools
  // read claim + endpoint from a mutable ref too.
  const emitRef: { emit: (e: AgentEvent) => void } = { emit: () => {} };
  const toolSpecRef: { endpoint: string; claim: string } = { endpoint: req.tools.endpoint, claim: req.tools.claim };

  const tools = buildTransportTools(
    {
      catalog: req.tools.catalog,
      get endpoint() {
        return toolSpecRef.endpoint;
      },
      get claim() {
        return toolSpecRef.claim;
      },
    } as InvocationRequest['tools'],
    e => emitRef.emit(e),
  );

  const excludeTools = new Set(req.agent.excludeTools ?? []);
  const kept = tools.filter(t => !excludeTools.has(t.name));

  // Explicit tools: deepagents defaults a custom subagent's tools to [],
  // which would leave specialists without the transport tool surface.
  const subagents = (req.agent.subagents ?? []).map((s): SubAgent => ({
    name: s.name,
    description: s.description,
    systemPrompt: s.systemPrompt,
    tools: kept as SubAgent['tools'],
  }));

  // Read through on every model request, never captured by value — the
  // session belongs to whichever invocation is currently being served.
  const awsRef: GraphEntry['awsRef'] = { session: req.aws };
  const model = await buildChatModel({
    model: req.agent.model,
    temperature: req.agent.temperature,
    maxTokens: req.agent.maxTokens,
    readAwsSession: () => awsRef.session,
  });

  const hasPlaybooks = Object.keys(req.files ?? {}).some(p => p.startsWith('/playbooks/') || p.startsWith('/skills/'));

  const graph = createDeepAgent({
    model,
    tools: kept,
    subagents,
    systemPrompt: req.agent.systemPrompt || undefined,
    backend: new StateBackend(),
    ...(hasPlaybooks ? { skills: ['/skills/', '/playbooks/'] } : {}),
  });

  const entry: GraphEntry = { graph, emitRef, awsRef };
  Object.assign(entry, { __toolSpecRef: toolSpecRef });
  if (graphCache.has(key)) {
    graphCache.delete(key);
  }
  graphCache.set(key, entry);
  while (graphCache.size > GRAPH_CACHE_LIMIT) {
    const first = graphCache.keys().next().value;
    if (first === undefined) {
      break;
    }
    graphCache.delete(first);
  }
  return entry;
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

export async function runInvocation(
  req: InvocationRequest,
  emit: (event: AgentEvent) => void,
): Promise<void> {
  const entry = await getGraph(req);
  entry.emitRef.emit = emit;
  entry.awsRef.session = req.aws;
  const toolSpecRef = (entry as unknown as { __toolSpecRef: { endpoint: string; claim: string } }).__toolSpecRef;
  toolSpecRef.endpoint = req.tools.endpoint;
  toolSpecRef.claim = req.tools.claim;

  const toolCallCount = { n: 0 };

  const trace = createRuntimeTrace({
    agentSlug: req.agent.slug,
    orgId: req.trace?.orgId,
    userId: req.trace?.userId,
    sessionId: req.sessionId,
    input: { message: req.message },
    onTurnEnd: turn => emit({ type: 'usage', ...turn }),
  });

  emit({ type: 'thinking' });

  // Context source: prefer AgentCore Memory when enabled, but only when
  // it's at least as complete as the payload history — conversations
  // that predate Memory (or hit a failed write) keep their Postgres
  // history. Callers running VOCION_MEMORY_AUTHORITATIVE=1 omit payload
  // history entirely, so Memory wins by construction and turns stop
  // being resent. Every failure degrades to payload — chat never breaks.
  let sourceTurns = req.conversationHistory ?? [];
  const useMemory = memoryEnabled(req.memory);
  if (useMemory) {
    const fromMemory = await loadHistory(req.memory!);
    if (fromMemory !== null && fromMemory.length >= sourceTurns.length) {
      sourceTurns = fromMemory;
    }
  }
  const history = sourceTurns
    .filter(t => t.content.trim().length > 0)
    .map(t => ({ role: t.role, content: t.content }));

  // Long-term memory: facts/preferences the store's extraction
  // strategies distilled from this actor's PAST conversations. Injected
  // as a context preamble on the model input only — req.message stays
  // pristine for persistence (core's Postgres log and saveTurn below).
  let modelMessage = req.message;
  if (useMemory) {
    const recalled = await retrieveLongTerm(req.memory!.actorId, req.message);
    if (recalled.length > 0) {
      modelMessage
        = `[Long-term memory about this user from previous conversations — use when relevant, never mention this block:\n${recalled.map(r => `- ${r}`).join('\n')}\n]\n\n${req.message}`;
    }
  }

  const input = {
    messages: [...history, { role: 'user', content: modelMessage }],
    files: req.files ?? {},
  };

  let finalText = '';

  try {
    const run = await entry.graph.streamEvents(input as never, {
      version: 'v3',
      callbacks: [trace.handler],
    } as never);

    await Promise.all([
      (async () => {
        for await (const msg of run.messages) {
          await Promise.all([
            (async () => {
              let started = false;
              for await (const token of msg.text) {
                if (!started) {
                  started = true;
                  emit({ type: 'answering' });
                }
                finalText += token;
                emit({ type: 'response_delta', delta: token });
              }
            })(),
            (async () => {
              for await (const delta of msg.reasoning) {
                emit({ type: 'thinking_delta', delta });
              }
            })(),
          ]);
        }
      })(),
      (async () => {
        for await (const call of run.toolCalls) {
          const name = (call as { name?: string }).name ?? 'tool';
          const inputPromise = (call as { input: Promise<Record<string, unknown>> | Record<string, unknown> }).input;
          const inputResolved = inputPromise instanceof Promise ? await inputPromise : inputPromise;
          emit({ type: 'tool_start', tool: name, input: inputResolved ?? {} });
          let outputStr = '';
          try {
            const out = await (call as { output: Promise<unknown> }).output;
            outputStr = typeof out === 'string' ? out : JSON.stringify(out).slice(0, 2000);
          } catch (err) {
            outputStr = `tool error: ${(err as Error).message}`;
          }
          emit({ type: 'tool_end', tool: name, input: inputResolved ?? {}, output: outputStr });
          toolCallCount.n += 1;
        }
      })(),
      (async () => {
        for await (const sub of run.subagents) {
          const name = (sub as { name?: string }).name ?? 'subagent';
          emit({ type: 'subagent_start', name });
          try {
            await (sub as { output?: Promise<unknown> }).output;
          } catch {
            /* surfaces via parent flow */
          }
          emit({ type: 'subagent_end', name });
        }
      })(),
    ]);

    await run.output;
  } catch (err) {
    const message = (err as Error).message ?? 'agent run failed';
    emit({ type: 'error', message });
    await trace.end({ error: message });
    throw err;
  }

  if (useMemory) {
    await saveTurn(req.memory!, req.message, finalText);
  }
  await trace.end({ response: finalText.slice(0, 500), toolCalls: toolCallCount.n });
  emit({ type: 'done', response: finalText, traceId: trace.traceId });
}
