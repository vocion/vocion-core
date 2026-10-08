/**
 * What the `onboarding` spec needs: an admin to sign in as, and a shared
 * workspace on its first day. The admin is tolerated when it exists already;
 * the workspace is new on every run (`newWorkspace.ts`). Set
 * `E2E_ONBOARDING_EMAIL` and `E2E_ONBOARDING_SECRET` to sign in as a person a
 * dev database already has.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { tolerateExistingUser } from '../../../tests/TestUtils';

export const ADMIN = {
  name: 'Dana Okafor',
  org: 'Northwind',
  email: process.env.E2E_ONBOARDING_EMAIL ?? 'onboarding-e2e@northwind.example',
  secret: process.env.E2E_ONBOARDING_SECRET ?? 'onboarding-e2e-secret-1',
};
const ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Run one of the repo's scripts the way the other e2e seeders do.
 * @param args - Arguments after `tsx`, starting with the script path.
 */
function run(args: string[]): void {
  execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', ...args], { cwd: ROOT, stdio: ['ignore', 'inherit', 'pipe'], env: process.env });
}

/**
 * The admin, and a new workspace for this run.
 * @returns The new workspace's slug and name.
 */
export function seedOnboarding(): { slug: string; name: string } {
  if (!process.env.E2E_ONBOARDING_EMAIL) {
    try {
      run(['src/scripts/create-local-user.ts', '--email', ADMIN.email, '--name', ADMIN.name, '--org', ADMIN.org, '--password', ADMIN.secret, '--role', 'admin']);
    } catch (error) {
      tolerateExistingUser(error, '[onboarding spec]');
    }
  }
  const slug = `support-${Date.now().toString(36)}`;
  const name = 'Northwind Support';
  run(['e2e/onboarding/support/newWorkspace.ts', ADMIN.email, slug, name]);
  return { slug, name };
}
