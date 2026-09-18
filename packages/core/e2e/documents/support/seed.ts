/**
 * What both `documents` specs need before their first turn: the fixtures on
 * disk, an admin to sign in as, and the sample workspace applied to that
 * admin's project. Idempotent — an existing user is tolerated, and apply is a
 * sync. Set `E2E_DOCUMENTS_EMAIL` / `E2E_DOCUMENTS_PASSWORD` to skip the
 * seeding and run against a database that already has them (a dev server).
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { tolerateExistingUser } from '../../../tests/TestUtils';

export const ADMIN = {
  name: 'Pat Reyes',
  account: 'Metacto',
  email: process.env.E2E_DOCUMENTS_EMAIL ?? 'documents@example.test',
  password: process.env.E2E_DOCUMENTS_PASSWORD ?? 'documents-e2e-1',
};
export const PRESEEDED = Boolean(process.env.E2E_DOCUMENTS_EMAIL);
const ROOT = path.resolve(__dirname, '..', '..', '..');

function run(args: string[]): void {
  execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', ...args], { cwd: ROOT, stdio: ['ignore', 'inherit', 'pipe'], env: process.env });
}

let seeded = false;

export function seedDocumentsWorkspace(): void {
  if (seeded) {
    return;
  }
  seeded = true;
  run(['e2e/documents/support/write-fixtures.ts']);
  if (PRESEEDED) {
    return;
  }
  try {
    run(['src/scripts/create-local-user.ts', '--email', ADMIN.email, '--name', ADMIN.name, '--account', ADMIN.account, '--password', ADMIN.password, '--role', 'admin']);
  } catch (error) {
    tolerateExistingUser(error, '[documents spec]');
  }
  // One project on a fresh database, so apply auto-targets it.
  run(['src/scripts/apply-workspace.ts', path.join(ROOT, 'templates', 'workspaces', 'client-documents')]);
}
