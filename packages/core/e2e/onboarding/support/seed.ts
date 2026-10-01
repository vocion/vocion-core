/**
 * What the `onboarding` spec needs before its first turn: an admin to
 * sign in as, and a workspace with an agent for them to talk to. Idempotent —
 * an existing user is tolerated, and apply is a sync. Set `E2E_ONBOARDING_EMAIL`
 * and `E2E_ONBOARDING_SECRET` to run against a database that already has them
 * (a dev server).
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { tolerateExistingUser } from '../../../tests/TestUtils';

export const ADMIN = {
  name: 'Jo Rivera',
  account: 'Northwind Setup',
  email: process.env.E2E_ONBOARDING_EMAIL ?? 'onboarding@example.test',
  secret: process.env.E2E_ONBOARDING_SECRET ?? 'onboarding-e2e-1',
};
export const PRESEEDED = Boolean(process.env.E2E_ONBOARDING_EMAIL);
const ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Run one of the repo's scripts the way the other e2e seeders do.
 * @param args - Arguments after `tsx`, starting with the script path.
 */
function run(args: string[]): void {
  execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', ...args], { cwd: ROOT, stdio: ['ignore', 'inherit', 'pipe'], env: process.env });
}

let seeded = false;

export function seedOnboardingWorkspace(): void {
  if (seeded) {
    return;
  }
  seeded = true;
  if (PRESEEDED) {
    return;
  }
  try {
    run(['src/scripts/create-local-user.ts', '--email', ADMIN.email, '--name', ADMIN.name, '--account', ADMIN.account, '--password', ADMIN.secret, '--role', 'admin']);
  } catch (error) {
    tolerateExistingUser(error, '[onboarding spec]');
  }
  // One project on a fresh database, so apply auto-targets it.
  run(['src/scripts/apply-workspace.ts', path.join(ROOT, 'templates', 'workspaces', 'client-documents')]);
}
