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
import { AsyncLocalStorage } from 'node:async_hooks';
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
 * Everything about one invocation that a cached graph must read rather than
 * capture.
 *
 * The graph is expensive to build and identical for every request with the
 * same definition, so it is reused across invocations. That makes anything
 * per-request dangerous to bake in — most of all `awsSession`, which is the
 * caller's temporary Bedrock credential.
 */
type InvocationContext = {
  emit: (event: AgentEvent) => void;
  awsSession: InvocationRequest['aws'];
  toolEndpoint: string;
  toolClaim: string;
};

/**
 * The invocation currently being served, as async-local state.
 *
 * This used to be three mutable refs hanging off the cached graph entry, which
 * `runInvocation` overwrote in place before each run. That is correct only
 * while one invocation runs at a time, and nothing guaranteed it: `server.ts`
 * is a plain Node HTTP server, and two requests that hash to the same graph —
 * same org, same agent definition, different users or conversations — are
 * served concurrently and shared one entry. The second request's assignments
 * landed while the first was mid-turn, so its streamed events could be
 * delivered through the other caller's `emit`, and its tool calls could go out
 * under the other caller's signed claim, which carries a different
 * conversation and a different allowed-source scope.
 *
 * AsyncLocalStorage gives each invocation its own view of that state for the
 * whole async tree beneath it, so concurrent runs cannot see each other's
 * while the graph stays shared.
 *
 * On the deployed path AgentCore Runtime gives each session its own microVM
 * and core sends a fresh session id per invocation, so the collision was hard
 * to reach in production. It was reachable wherever the artifact serves more
 * than one caller from one process, which is exactly how it runs locally
 * (`npm run dev:agent-runtime`).
 */
const invocationContext = new AsyncLocalStorage<InvocationContext>();

/**
 * The context for the invocation on this async stack.
 *
 * Throws rather than substituting a default: a graph that reaches this outside
 * `runInvocation` would otherwise emit into a void, or worse, call a tool with
 * no claim. Loud is the only safe answer, and it can only mean a bug in this
 * file.
 */
function currentInvocationContext(): InvocationContext {
  const context = invocationContext.getStore();
  if (!context) {
    throw new Error('agent-runtime: invocation state read outside runInvocation');
  }
  return context;
}

type GraphEntry = {
  graph: ReturnType<typeof createDeepAgent>;
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

  // The graph is cache-shared; the endpoint, the claim and the emit callback
  // belong to whichever invocation is being served. The claim in particular
  // rotates per request and is NOT part of the cache key, so it must be read
  // at call time rather than captured here.
  const tools = buildTransportTools(
    {
      catalog: req.tools.catalog,
      get endpoint() {
        return currentInvocationContext().toolEndpoint;
      },
      get claim() {
        return currentInvocationContext().toolClaim;
      },
    } as InvocationRequest['tools'],
    event => currentInvocationContext().emit(event),
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
  const model = await buildChatModel({
    model: req.agent.model,
    temperature: req.agent.temperature,
    maxTokens: req.agent.maxTokens,
    readAwsSession: () => currentInvocationContext().awsSession,
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

  const entry: GraphEntry = { graph };
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

/**
 * Serve one invocation.
 *
 * The whole turn runs inside an `AsyncLocalStorage` scope holding this
 * request's emit callback, Bedrock session, tool endpoint and signed claim.
 * The compiled graph is shared between concurrent callers; this scope is what
 * keeps their per-request state apart. See `invocationContext`.
 * @param req - The invocation payload: agent definition, message, tool spec,
 * and this caller's temporary Bedrock session.
 * @param emit - Where this turn's events go. Belongs to this caller alone.
 */
export async function runInvocation(
  req: InvocationRequest,
  emit: (event: AgentEvent) => void,
): Promise<void> {
  const context: InvocationContext = {
    emit,
    awsSession: req.aws,
    toolEndpoint: req.tools.endpoint,
    toolClaim: req.tools.claim,
  };
  return invocationContext.run(context, () => runTurn(req, emit));
}

async function runTurn(
  req: InvocationRequest,
  emit: (event: AgentEvent) => void,
): Promise<void> {
  const entry = await getGraph(req);

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
          } catch (error) {
            // Not rethrown: the parent graph decides what a failed specialist
            // means for the turn, and aborting the whole stream here would
            // take down an answer the parent can still give. But it is logged,
            // because the old comment claimed the failure "surfaces via parent
            // flow" and nothing guaranteed that — a specialist that always
            // failed left no trace anywhere.
            console.error(
              `[agent-runtime] subagent ${name} failed:`,
              error instanceof Error ? error.message : error,
            );
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
