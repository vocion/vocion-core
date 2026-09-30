import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPlan, serviceSpec } from './services.mjs';

const defaults = { postgresUrl: 'postgresql://postgres:postgres@localhost:5432/postgres' };

test('a service named alone waits at the runner default and exports the usual variables', () => {
  assert.deepEqual(serviceSpec('postgres', defaults), { name: 'postgres', url: defaults.postgresUrl, env: ['DATABASE_URL', 'TEST_DATABASE_URL'], setup: [] });
});

test('a service the repo record describes waits where it says and runs its setup', () => {
  const s = serviceSpec({ name: 'postgres', url: 'postgresql://runner:runner@localhost:55432/ledger', env: ['DATABASE_URL'], setup: ['npm run db:migrate -w @northwind/api'] }, defaults);
  assert.deepEqual(s, { name: 'postgres', url: 'postgresql://runner:runner@localhost:55432/ledger', env: ['DATABASE_URL'], setup: ['npm run db:migrate -w @northwind/api'] });
});

test('a check with a command runs that command; a built-in runs its script or says why it cannot', () => {
  const plan = checkPlan({
    required_checks: ['test', 'no-em-dashes', 'lint', 'build', 'e2e-local', 'typecheck'],
    checks: [{ name: 'test', command: 'npm test -- --run' }, { name: 'e2e-local', command: 'npx playwright test --project local' }],
  }, { lint: 'eslint .', typecheck: 'tsc' });
  assert.deepEqual(plan, [
    { name: 'test', kind: 'command', command: 'npm test -- --run' },
    { name: 'no-em-dashes', kind: 'em-dashes' },
    { name: 'lint', kind: 'script', command: 'npm run lint --silent' },
    { name: 'build', kind: 'skipped', reason: 'package.json has no "build" script' },
    { name: 'e2e-local', kind: 'command', command: 'npx playwright test --project local' },
    { name: 'typecheck', kind: 'script', command: 'npm run typecheck --silent' },
  ]);
});
