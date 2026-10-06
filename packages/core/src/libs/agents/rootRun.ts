import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';

/**
 * AN AGENT TURN IS ITS OWN ROOT RUN (FE-449 to FE-478, 2026-10-04 to 10-06: no mockup drawn).
 *
 * A turn can start inside another: a chat turn files a request from a tool call, the request's
 * automation starts the designer, and all of it runs in the chat turn's async context. Since
 * LangGraph 1.4 a graph started there copies that context's configurable, its abort signals
 * among it, so when the chat turn ended and its stream aborted its controller, the designer's
 * graph, eight seconds later, threw "Abort" 7 ms in, before any model call. Every mockup since
 * the upgrade failed that way.
 *
 * Run a turn with no ambient LangChain context: its own signal, its own callbacks, its own trace.
 * Everything awaited inside `fn` (the stream's whole iteration) runs in the cleared context.
 * @param fn - The turn.
 */
export function asRootRun<T>(fn: () => Promise<T>): Promise<T> {
  return AsyncLocalStorageProviderSingleton.getInstance().run(undefined, fn) as Promise<T>;
}
