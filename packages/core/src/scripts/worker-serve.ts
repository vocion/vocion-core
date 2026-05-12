/**
 * worker:serve — long-lived Node process for the feedback worker.
 *
 * Run via `npm run worker:serve` (workspace `@vocion/core`) or via the
 * `worker` sidecar in docker-compose.yml. Opt-in: set
 * ENABLE_FEEDBACK_WORKER=1 to actually start the loop. Otherwise the
 * process exits cleanly after logging — that lets the same image be
 * deployed to environments where the worker isn't wanted yet.
 */

import process from 'node:process';
import { runLoop } from '../services/FeedbackWorkerService';

if ((process.env.ENABLE_FEEDBACK_WORKER ?? '0') !== '1') {
  console.log('[worker:serve] ENABLE_FEEDBACK_WORKER is not set; exiting.');
  process.exit(0);
}

const handle = runLoop();

const shutdown = async (signal: string) => {
  console.log(`[worker:serve] caught ${signal}; stopping...`);
  handle.stop();
  await handle.done;
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
