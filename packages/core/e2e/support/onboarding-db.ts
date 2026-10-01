/**
 * Mark workspace setup (#1028) as already opened on every project, so an e2e
 * suite that is not about setup is not navigated away by the first-run
 * auto-start after sign-in.
 * Run: `npx dotenv -c -- npx tsx e2e/support/onboarding-db.ts mark-started`
 */

import process from 'node:process';
import { db } from '../../src/libs/DB';
import { projectSchema } from '../../src/models/Schema';

async function markStarted(): Promise<void> {
  const rows = await db
    .update(projectSchema)
    .set({ onboardingStartedAt: new Date(), onboardingStartedBy: 'e2e-seed' })
    .returning({ id: projectSchema.id });
  console.warn(`[onboarding-db] marked setup as started on ${rows.length} project(s)`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'mark-started') {
    await markStarted();
  } else {
    throw new Error(`onboarding-db: unknown command "${command}"`);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('[onboarding-db] failed', error);
  process.exit(1);
});
