/**
 * Reach the connect gate and the GitHub install without compiling them into
 * every route.
 *
 * The connect tools sit in the agent tool registry, which nearly every route
 * reaches, and Turbopack compiles everything a route reaches into it, `await
 * import()` targets included. Same shape as `libs/usageReviewBridge.ts`:
 * `instrumentation.ts` hands the module over when the Node server starts;
 * outside Next (vitest, scripts, the worker) this imports it directly, with
 * the import hidden from Turbopack.
 */

import type * as ConnectAskApi from '@/services/connect/connectAskApi';

export type ConnectAsk = typeof ConnectAskApi;

const KEY = Symbol.for('vocion.connectAsk');

type WithConnectAsk = { [KEY]?: ConnectAsk };

/**
 * Hand the module over. Called once, by `instrumentation.ts`.
 * @param api - `services/connect/connectAskApi.ts`.
 */
export function provideConnectAsk(api: ConnectAsk): void {
  (globalThis as WithConnectAsk)[KEY] = api;
}

/** The connect gate's and the GitHub install's entry points. */
export async function connectAsk(): Promise<ConnectAsk> {
  const provided = (globalThis as WithConnectAsk)[KEY];
  if (provided) {
    return provided;
  }
  return import(/* turbopackIgnore: true */ /* webpackIgnore: true */ '@/services/connect/connectAskApi');
}
