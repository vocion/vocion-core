import { launchDurableExecutor } from './dbos';
import './definitions';

/**
 * Start this process as the one durable executor (v0.6.0). Called from
 * `instrumentation.ts` in the Node.js runtime. The executor runs every
 * durable run, fires every schedule, and does the housekeeping the Temporal
 * worker used to: the deployment-wide schedules, the abandoned-fire sweep and
 * the notification queue.
 *
 * Exactly one process is the executor: the one with `VOCION_SCHEDULE_OWNER=1`
 * (the app on the box). Every other process — a dev server pointed at a
 * tunnelled production database, a tooling container — is a client only, so
 * it can neither recover another executor's runs nor fire its schedules.
 * Off under test, in memory mode, during the build, and with
 * `DURABLE_EXECUTOR=off`.
 */
export async function startDurableExecutor(): Promise<void> {
  if (process.env.DURABLE_EXECUTOR === 'off' || process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }
  const { durableMode } = await import('./index');
  if (durableMode() !== 'dbos') {
    return;
  }
  if (process.env.VOCION_SCHEDULE_OWNER !== '1') {
    // Loud where it matters: a production app without the flag runs no flows and fires no schedules.
    const say = process.env.NODE_ENV === 'production' ? console.error : console.warn;
    say('[durable] this process is not the executor (VOCION_SCHEDULE_OWNER != 1): runs and schedules are left to the one that is');
    return;
  }
  try {
    await launchDurableExecutor();
    console.warn('[durable] executor up', { version: process.env.DURABLE_APP_VERSION ?? 'durable-1' });
  } catch (err) {
    // Loud: a dead executor means waiting runs never resume.
    console.error('[durable] the executor did not start', (err as Error).message);
    return;
  }
  const { startHousekeeping } = await import('@/services/background/housekeeping');
  await startHousekeeping();
}
