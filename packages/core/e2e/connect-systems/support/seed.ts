/**
 * What the `connect-systems` spec needs: an admin to sign in as and a
 * workspace with an agent to talk to. Idempotent. Set `E2E_CONNECT_EMAIL` and
 * `E2E_CONNECT_SECRET` to sign in as a person a dev database already has.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { tolerateExistingUser } from '../../../tests/TestUtils';

export const ADMIN = {
  name: 'Dana Okafor',
  account: 'Northwind',
  email: process.env.E2E_CONNECT_EMAIL ?? 'connect-systems-e2e@northwind.example',
  secret: process.env.E2E_CONNECT_SECRET ?? 'connect-systems-e2e-secret-1',
};
const ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Run one of the repo's scripts the way the other e2e seeders do.
 * @param args - Arguments after `tsx`, starting with the script path.
 */
function run(args: string[]): void {
  execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', ...args], { cwd: ROOT, stdio: ['ignore', 'inherit', 'pipe'], env: process.env });
}

let seeded = false;

export function seedConnectSystems(): void {
  if (seeded || process.env.E2E_CONNECT_EMAIL) {
    return;
  }
  seeded = true;
  try {
    run(['tests/support/create-e2e-user.ts', '--email', ADMIN.email, '--name', ADMIN.name, '--account', ADMIN.account, '--password', ADMIN.secret, '--role', 'admin']);
  } catch (error) {
    tolerateExistingUser(error, '[connect-systems spec]');
  }
  run(['src/scripts/apply-workspace.ts', path.join(ROOT, 'templates', 'workspaces', 'client-documents')]);
}
