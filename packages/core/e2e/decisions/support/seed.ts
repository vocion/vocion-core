/**
 * What the `decisions` spec needs before its first turn: an admin to sign in
 * as, and a workspace with an agent to talk to. Idempotent — an existing user
 * is tolerated, and apply is a sync. Set `E2E_CHAT_EMAIL` and
 * `E2E_CHAT_SECRET` to run against a database that already has them.
 * Fixtures are fictional.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { tolerateExistingUser } from '../../../tests/TestUtils';

export const ADMIN = {
  name: 'Dana Reyes',
  account: 'Metacto',
  email: process.env.E2E_CHAT_EMAIL ?? 'decisions@example.test',
  secret: process.env.E2E_CHAT_SECRET ?? 'decisions-e2e-1',
};
const PRESEEDED = Boolean(process.env.E2E_CHAT_EMAIL);
const ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Run one of the repo's scripts the way the other e2e seeders do.
 * @param args - Arguments after `tsx`, starting with the script path.
 */
function run(args: string[]): void {
  execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', ...args], { cwd: ROOT, stdio: ['ignore', 'inherit', 'pipe'], env: process.env });
}

let seeded = false;

export function seedDecisionsWorkspace(): void {
  if (seeded) {
    return;
  }
  seeded = true;
  if (PRESEEDED) {
    return;
  }
  try {
    run(['tests/support/create-e2e-user.ts', '--email', ADMIN.email, '--name', ADMIN.name, '--account', ADMIN.account, '--password', ADMIN.secret, '--role', 'admin']);
  } catch (error) {
    tolerateExistingUser(error, '[decisions spec]');
  }
  // One project on a fresh database, so apply auto-targets it.
  run(['src/scripts/apply-workspace.ts', path.join(ROOT, 'templates', 'workspaces', 'client-documents')]);
}
