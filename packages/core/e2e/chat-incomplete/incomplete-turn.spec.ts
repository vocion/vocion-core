import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { ADMIN, seedChatWorkspace } from './support/seed';

/**
 * A turn that dies part-way, as a person meets it (#114).
 *
 * The scripted model speaks the first half of an answer and then throws —
 * `e2e/chat-incomplete/scripts/mid-stream-failure.json` — which is the shape
 * of a run that loses its model with text already on screen. Everything else
 * is real: the SSE route, the row it writes, the reload, the next turn.
 *
 * What this guards is the thing a unit test cannot see end to end: after a
 * reload the fragment is still there AND still marked, so a half answer is
 * never read as a whole one; and the turn after it carries on normally
 * rather than inheriting the cut-off sentence as history.
 *
 * The server has to be started with the scripted model
 * (`npm run e2e:chat-incomplete` does it):
 *   VOCION_LLM_PROVIDER=scripted
 *   VOCION_LLM_SCRIPT=e2e/chat-incomplete/scripts/mid-stream-failure.json
 *   WORKSPACE_PATH=templates/workspaces/client-documents
 *
 * Self-seeding like the other e2e projects: a fresh database gets an admin
 * and the sample workspace applied to their project.
 */

test.beforeAll(() => {
  seedChatWorkspace();
});

/**
 * Sign in and land on the dashboard.
 * @param page - The browser page.
 */
async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.secret);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

/**
 * Type a line into the chat and send it.
 * @param page - The browser page.
 * @param line - What the person types.
 */
async function say(page: Page, line: string) {
  const box = page.locator('textarea').last();
  await box.click();
  await box.fill(line);
  await page.getByRole('button', { name: 'Send message' }).last().click();
}

test('a turn that fails mid-answer keeps its text, says it is unfinished, and survives a reload', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/chat');

  await say(page, 'how many deals closed last month?');

  // The fragment the model managed to speak before it died.
  await expect(page.getByText('Four deals closed last month, worth').last()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('incomplete-turn-notice').last()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60_000 });

  // The persisted row, not the live stream: the notice has to come back with
  // the transcript, because the fragment outlives the tab it arrived in.
  await page.reload();

  await expect(page.getByText('Four deals closed last month, worth').last()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('incomplete-turn-notice').last()).toBeVisible({ timeout: 120_000 });

  // The thread carries on: the next turn answers normally, and only the
  // failed turn wears the notice.
  await say(page, 'who owns northwind?');

  await expect(page.getByText('Pat Reyes owns Northwind').last()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('incomplete-turn-notice')).toHaveCount(1);
});
