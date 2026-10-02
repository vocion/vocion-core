import { launchDurableExecutor } from './dbos';
import './definitions';

/**
 * Start this process as the one durable executor. Called from
 * `instrumentation.ts` in the Node.js runtime; off under test, in memory
 * mode, or with `DURABLE_EXECUTOR=off` (a second process that must only be a
 * client, never recover runs).
 */
export async function startDurableExecutor(): Promise<void> {
  if (process.env.DURABLE_EXECUTOR === 'off' || process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }
  const { durableMode } = await import('./index');
  if (durableMode() !== 'dbos') {
    return;
  }
  try {
    await launchDurableExecutor();
    console.warn('[durable] executor up', { version: process.env.DURABLE_APP_VERSION ?? 'durable-1' });
  } catch (err) {
    // Loud: a dead executor means waiting runs never resume.
    console.error('[durable] the executor did not start', (err as Error).message);
  }
}
