import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * Needs you — accept in one move. Three questions recommend "Approve", so they
 * are one batch above the queue; one move accepts all three, each decided as
 * recommended by the person, and the one that recommends something else is
 * left where it was.
 *
 * Self-seeding like the `queue` project: it makes its own admin (the sign-up
 * route is invite-only) and files its questions straight into the database.
 *
 * Run with: npx playwright test --project=needs-you
 */

const ADMIN = {
  name: 'Needs You Admin',
  account: 'Needs You E2E Co',
  email: 'needs-you-admin@example.test',
  password: 'needs-you-admin-1',
};

const SEED = 'e2e/needs-you/support/seed-batch-asks.ts';

function seed(): void {
  try {
    execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', SEED, '--email', ADMIN.email], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const err = error as { stderr?: unknown };
    throw new Error(`${SEED} failed: ${String(err.stderr ?? '').trim().split('\n').at(-1) ?? error}`);
  }
}

function createBootstrapAdmin(): void {
  try {
    execFileSync(
      'npm',
      ['run', '--silent', 'user:create:e2e', '--', '--email', ADMIN.email, '--name', ADMIN.name, '--account', ADMIN.account, '--password', ADMIN.password, '--role', 'admin'],
      { stdio: 'pipe' },
    );
  } catch (error) {
    const text = String((error as { stderr?: unknown }).stderr ?? '');
    if (!/already|exists/i.test(text)) {
      throw new Error(`user:create failed: ${text.trim().split('\n').at(-1) ?? error}`);
    }
  }
}

test.beforeAll(() => {
  createBootstrapAdmin();
  seed();
});

test('accepts every decision that recommends the same thing in one move', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(url => !url.pathname.includes('sign-in'));

  await page.goto('/dashboard/inbox');

  // One batch: the three that recommend "Approve", however they spell it.
  const batch = page.getByTestId('inbox-batch');

  await expect(batch).toHaveCount(1);
  await expect(batch).toContainText('3 recommend “Approve”');

  // What it covers is one click away.
  await batch.getByRole('button', { name: /Show the 3 decisions/ }).click();
  const items = batch.getByTestId('inbox-batch-items');

  await expect(items).toContainText('Renew the Northwind support contract?');
  await expect(items).toContainText('Publish the Contoso Supply case study?');
  await expect(items).not.toContainText('Move the Acme review');

  await batch.getByTestId('inbox-batch-accept').click();

  await expect(page.getByText('Approve · 3 decisions accepted').first()).toBeVisible();

  // Off the open queue; the question with another recommendation stays.
  await page.reload();

  await expect(page.getByTestId('inbox-batch')).toHaveCount(0);
  await expect(page.getByTestId('inbox-list')).not.toContainText('Renew the Northwind support contract?');
  await expect(page.getByTestId('inbox-list')).toContainText('Move the Acme review to Thursday?');

  // Decided by the person, as recommended.
  await page.goto('/dashboard/inbox?tab=decided');

  await expect(page.getByTestId('inbox-list')).toContainText('Renew the Northwind support contract?');

  expect(errors).toEqual([]);
});
