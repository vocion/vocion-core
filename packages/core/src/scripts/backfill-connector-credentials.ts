#!/usr/bin/env tsx
/**
 * One-time backfill: move every API-key connector off its own credential copy
 * and onto a stored workspace credential.
 *
 * The work itself lives in `services/ConnectorCredentialBackfill` so it can be
 * tested; this is the command that runs it and prints what happened.
 *
 * Idempotent — a connector already pointing at a stored credential is skipped,
 * so re-running after fixing a reported connector only moves that one.
 *
 * Usage: npm run connectors:backfill-credentials
 */
import process from 'node:process';
import { backfillConnectorCredentials } from '@/services/ConnectorCredentialBackfill';

async function main(): Promise<void> {
  const report = await backfillConnectorCredentials();

  for (const moved of report.moved) {
    console.warn(`✓ ${moved.sourceSlug} (connector ${moved.sourceId}, org ${moved.orgId}) → credential ${moved.apiTokenId}`);
  }
  for (const skipped of report.skipped) {
    console.warn(`• skipped ${skipped.sourceSlug} (connector ${skipped.sourceId}, org ${skipped.orgId}): ${skipped.reason}`);
  }
  console.warn(`Moved ${report.moved.length}, skipped ${report.skipped.length}.`);

  // A skipped connector is not a failure of the run — it is one someone has to
  // look at, and the exit code says so without hiding what did move.
  process.exit(report.skipped.length > 0 ? 2 : 0);
}

main().catch((error) => {
  console.error('Connector credential backfill failed:', error);
  process.exit(1);
});
