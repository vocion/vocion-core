import type { DurableEngine } from './types';
import { dbosEngine } from './dbos';
import { memoryEngine } from './memory';

export { defineDurable, durableIdFor } from './registry';
export type { DeliveredEvent, DurableContext, DurableDefinition, DurableEngine, DurableRunState, DurableStatus, WaitForEventOptions } from './types';

/**
 * Which runtime this process uses: DBOS on the app database in production and
 * dev, the in-process one under test (or `DURABLE_MODE=memory`).
 */
export function durableMode(): 'dbos' | 'memory' {
  if (process.env.DURABLE_MODE === 'memory' || process.env.DURABLE_MODE === 'dbos') {
    return process.env.DURABLE_MODE;
  }
  return process.env.VITEST || process.env.NODE_ENV === 'test' ? 'memory' : 'dbos';
}

/** The engine every caller starts, signals, reads and cancels runs through. */
export function durable(): DurableEngine {
  return durableMode() === 'memory' ? memoryEngine() : dbosEngine();
}

/**
 * Hand an event to the runs waiting for it (called by `emitEvent`). Never
 * throws: the event is recorded either way, and a wait that misses the send
 * still finds it in `event_log` when it opens.
 * @param orgId - The event's workspace.
 * @param type - Its type.
 * @param payload - Its payload.
 * @param at - When it was recorded.
 */
export async function forwardEvent(orgId: string, type: string, payload: Record<string, unknown>, at: Date): Promise<number> {
  try {
    const { forwardToWaits } = await import('./events');
    return await forwardToWaits(orgId, type, payload, at, (id, topic, message) => durable().signal(id, topic, message));
  } catch (err) {
    console.warn('[durable] an event could not be forwarded', { orgId, type, message: (err as Error).message });
    return 0;
  }
}
