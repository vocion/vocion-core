#!/usr/bin/env tsx
/**
 * Give every existing member of every account their personal workspace now,
 * rather than at their next sign-in.
 *
 * Optional. Sign-in creates a person's personal workspace in each of their
 * accounts (`ensurePersonalProjectsForUser`), so a deployment that does
 * nothing gets everyone theirs as they arrive. Run this when a deployment
 * wants them in place first — for instance before turning on a feature that
 * reaches into them. Idempotent: re-running creates nothing new.
 *
 * Deliberately not part of the deploy's migration step: a new workspace in
 * every switcher is a product change, so an operator decides when it lands.
 *
 * Usage: npm run personal-projects:backfill
 */
import process from 'node:process';
import { backfillPersonalProjects } from '@/services/workspace/personalProject';

async function main() {
  const { checked, created } = await backfillPersonalProjects();
  console.log(`✓ ${checked} membership(s) checked, ${created} personal workspace(s) created.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
