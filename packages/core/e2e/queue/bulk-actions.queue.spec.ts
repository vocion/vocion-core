import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * Metacto tickets 071 and 076: the bulk actions page loads, opens with the
 * queue's view selected, and lets a reviewer filter and tick leads.
 *
 * This spec exists because the page once shipped green and crashed on every
 * load: its tests covered the component and the API, and nothing rendered
 * the page itself. It never presses the button, so no job starts.
 */

const ADMIN = {
  name: 'Queue Admin',
  account: 'Queue E2E Co',
  email: 'queue-admin@example.test',
  password: 'queue-admin-1',
};

const SEED = 'e2e/queue/support/seed-bulk-leads.ts';

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
      ['run', '--silent', 'user:create', '--', '--email', ADMIN.email, '--name', ADMIN.name, '--account', ADMIN.account, '--password', ADMIN.password, '--role', 'admin'],
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

test('the bulk page opens on the queue\'s view selected, and filters and ticks leads', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(url => !url.pathname.includes('sign-in'));

  // Arrive the way the queue's Bulk actions link does: its lane and search on the URL.
  await page.goto('/gtm/personalization/bulk?tab=all&q=bulkfixture');

  await expect(page.getByTestId('bulk-actions-view')).toBeVisible();
  await expect(page.getByTestId('bulk-filter-q')).toHaveValue('bulkfixture');
  await expect(page.getByTestId('bulk-count')).toHaveText('2 of 2 selected');
  await expect(page.getByTestId('bulk-blocked')).toContainText('1 lead is not waiting in Review');

  await page.getByLabel('Select Wren Bulkfixture').uncheck();

  await expect(page.getByTestId('bulk-count')).toHaveText('1 of 2 selected');
  await expect(page.getByTestId('bulk-submit')).toHaveText('Regenerate 1 brief');

  await page.getByTestId('bulk-filter-rung').selectOption('Personalized Nurture · 4 Assertive v2');

  await expect(page.getByTestId('bulk-count')).toHaveText('1 of 1 selected');
  await expect(page.getByLabel('Select Wren Bulkfixture')).toBeChecked();

  expect(errors).toEqual([]);
});
