#!/usr/bin/env tsx
/**
 * One-time move: put every existing GitHub, Atlassian and Slack login into the
 * workspace credential store and link the connector's sources to it.
 *
 * The work lives in `services/connect/moveLogins` so it can be tested; this is
 * the command that runs it and prints what happened. It never prints a
 * credential value, and it never revokes the old `source_credential` row: a
 * bad move is undone by clearing `knowledge_source.api_token_id`.
 *
 * Idempotent: re-running moves only what is still unlinked.
 *
 * Usage: npm run connectors:move-logins
 */
import process from 'node:process';
import { moveLoginsToCredentialStore } from '@/services/connect/moveLogins';

async function main(): Promise<void> {
  const report = await moveLoginsToCredentialStore();

  for (const moved of report.moved) {
    console.warn(`✓ ${moved.connector} (org ${moved.orgId}) → login ${moved.tokenId}, linked ${moved.linkedSourceIds.length} source(s)`);
  }
  for (const skipped of report.skipped) {
    console.warn(`• skipped ${skipped.connector} (org ${skipped.orgId}): ${skipped.why}`);
  }
  console.warn(`Moved ${report.moved.length}, skipped ${report.skipped.length}.`);

  // A skipped login is one someone has to look at; the exit code says so.
  process.exit(report.skipped.length > 0 ? 2 : 0);
}

main().catch((error) => {
  console.error('Moving connector logins failed:', error);
  process.exit(1);
});
