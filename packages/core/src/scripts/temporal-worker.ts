/**
 * temporal-worker — long-lived Node process that runs Temporal
 * Workflows + Activities (Phase H.1).
 *
 * Run via `npm run temporal:worker`. Honors `ENABLE_TEMPORAL_WORKER=1`
 * for opt-in alongside the existing feedback worker. Docker-compose
 * `worker` profile spawns a sidecar; SIGTERM/SIGINT shuts it down
 * gracefully.
 *
 * Connects to Temporal at `VOCION_TEMPORAL_ADDRESS` (default
 * `localhost:7233`) and registers against the `vocion-workflows`
 * task queue.
 */

import path from 'node:path';
import process from 'node:process';
import { NativeConnection, Worker } from '@temporalio/worker';
import { temporalAddress, temporalNamespace, VOCION_WORKFLOWS_TASK_QUEUE } from '../libs/temporal/client';
import * as activities from '../services/temporal/activities';

async function main(): Promise<void> {
  if ((process.env.ENABLE_TEMPORAL_WORKER ?? '0') !== '1') {
    console.log('[temporal:worker] ENABLE_TEMPORAL_WORKER is not set; exiting.');
    process.exit(0);
  }

  const address = temporalAddress();
  const namespace = temporalNamespace();

  console.log(`[temporal:worker] connecting to ${address} (namespace=${namespace})…`);

  const connection = await NativeConnection.connect({ address });

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
    // Path to the file that exports `vocionWorkflow`. Temporal needs
    // a file path (not a module import) so it can bundle the
    // deterministic sandbox. The path is resolved relative to this
    // script's compiled location.
    workflowsPath: require.resolve('../services/temporal/workflows/vocionWorkflow'),
    activities,
  });

  console.log(`[temporal:worker] started — task queue: ${VOCION_WORKFLOWS_TASK_QUEUE}`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[temporal:worker] caught ${signal}; shutting down…`);
    worker.shutdown();
    await connection.close();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await worker.run();
}

main().catch((err) => {
  console.error('[temporal:worker] fatal error', err);
  process.exit(1);
});

// Silence unused-import warning for `path` while the file evolves
// during Phase H; the bundler may need `path` for the workflows path.
void path;
