/**
 * What the `list-intake` spec needs before its first turn: an admin, the
 * small revenue workspace (`../workspace`) and what it already holds (Rowan
 * as a Lead, Dana as a CRM contact). Idempotent. Set `E2E_CHAT_EMAIL` and
 * `E2E_CHAT_SECRET` to run against a database that already has the user.
 * Fixtures are fictional.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { tolerateExistingUser } from '../../../tests/TestUtils';

export const ADMIN = {
  name: 'Alex Rivera',
  account: 'Metacto',
  email: process.env.E2E_CHAT_EMAIL ?? 'list-intake@example.test',
  secret: process.env.E2E_CHAT_SECRET ?? 'list-intake-e2e-1',
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

export function seedListIntakeWorkspace(): void {
  if (seeded) {
    return;
  }
  seeded = true;
  if (!PRESEEDED) {
    try {
      run(['tests/support/create-e2e-user.ts', '--email', ADMIN.email, '--name', ADMIN.name, '--account', ADMIN.account, '--password', ADMIN.secret, '--role', 'admin']);
    } catch (error) {
      tolerateExistingUser(error, '[list-intake spec]');
    }
  }
  run(['src/scripts/apply-workspace.ts', path.join(ROOT, 'e2e', 'list-intake', 'workspace')]);
  run(['e2e/list-intake/support/seed-records.ts']);
}
