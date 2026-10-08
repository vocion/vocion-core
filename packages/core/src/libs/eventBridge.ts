/**
 * Emit an event from code that must not import the event bus.
 *
 * `libs/Auth.ts` is imported by nearly every route, and Turbopack compiles
 * everything a route reaches into that route, `await import()` targets
 * included. `services/EventService.ts` reaches workflows, agents, the tools
 * and every connector, so one `import('@/services/EventService')` on the
 * sign-in path put the whole server into almost every route: v5.12.0 to
 * v5.15.1 doubled the production build's compile time and pushed its peak
 * memory past what the deploy runners have. `scripts/check-route-graph.ts`
 * holds the line in CI.
 *
 * So the sign-in path emits through here. `instrumentation.ts` hands the real
 * `emitEvent` over when the Node server starts, before it serves a request.
 * Outside Next (vitest, the `tsx` scripts, the worker) nothing hands it over,
 * and this imports the bus directly; the import is hidden from Turbopack.
 */

import type { EmitEventInput, EmitEventResult } from '@/services/EventService';

type Emit = (input: EmitEventInput) => Promise<EmitEventResult>;

const BUS = Symbol.for('vocion.eventBus.emit');

type WithBus = { [BUS]?: Emit };

/**
 * Hand the event bus over. Called once, by `instrumentation.ts`.
 * @param emit - `emitEvent` from `services/EventService.ts`.
 */
export function provideEventBus(emit: Emit): void {
  (globalThis as WithBus)[BUS] = emit;
}

/**
 * `emitEvent`, without importing the bus where this is imported.
 * @param input - As `emitEvent` takes it.
 * @returns What `emitEvent` returns.
 */
export async function emitEventDetached(input: EmitEventInput): Promise<EmitEventResult> {
  const provided = (globalThis as WithBus)[BUS];
  if (provided) {
    return provided(input);
  }
  const { emitEvent } = await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ '@/services/EventService');
  return emitEvent(input);
}
