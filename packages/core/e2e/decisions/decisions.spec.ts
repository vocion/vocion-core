import type { Page } from '@playwright/test';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { ADMIN, seedDecisionsWorkspace } from './support/seed';

/**
 * ONE DECISION, ANSWERED BY KEYBOARD — the docked card end to end.
 *
 * The scripted model (`e2e/decisions/scripts/chat.json`) asks one question
 * with `file_ask` in the person's own turn. Everything else is real: the tool
 * raises a Decision docked above the composer, the turn ends at it, the card
 * takes focus, the keys answer it, the answer travels TYPED to the agent that
 * asked (no words put in the person's mouth), and the receipt survives a
 * reload. The second case answers in words instead: the composer's message is
 * read against the open Decision before it is routed.
 *
 * The server has to be started with the scripted model
 * (`npm run e2e:decisions` does it):
 *   VOCION_LLM_PROVIDER=scripted
 *   VOCION_LLM_SCRIPT=e2e/decisions/scripts/chat.json
 *   WORKSPACE_PATH=templates/workspaces/client-documents
 *
 * `DECISIONS_SHOTS` names a directory to write the screenshots into.
 * Fixtures are fictional (Northwind).
 */

const SHOTS = process.env.DECISIONS_SHOTS;
const QUESTION = 'Which repo should the factory build in?';

test.beforeAll(() => {
  seedDecisionsWorkspace();
});

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.secret);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

async function say(page: Page, line: string) {
  const box = page.locator('textarea[data-agent-composer]').last();
  await box.click();
  await box.fill(line);
  await page.getByRole('button', { name: 'Send message' }).last().click();
}

async function shot(page: Page, name: string) {
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  }
}

async function freshChat(page: Page) {
  await page.goto('/dashboard/chat?new=1');

  await expect(page.locator('textarea[data-agent-composer]').last()).toBeVisible({ timeout: 120_000 });
}

test('the docked Decision is answered from the keyboard, typed — and the receipt survives a reload', async ({ page }) => {
  await signIn(page);
  await freshChat(page);
  await say(page, 'build the viewer export');

  const card = page.getByRole('dialog', { name: QUESTION });

  await expect(card).toBeVisible({ timeout: 120_000 });
  // The turn ended at the question: nothing was said past it.
  await expect(page.getByText('One question before I start.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60_000 });
  await expect(page.getByTestId('incomplete-turn-notice')).toHaveCount(0);

  // The recommendation first and preselected, the key hints visible, the
  // composer the other way to answer.
  const options = card.getByRole('option');

  await expect(options.first()).toContainText('Northwind API');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await expect(card.getByTestId('decision-key-hints')).toContainText('↵ submit');
  await expect(page.locator('textarea[data-agent-composer]').last()).toHaveAttribute('placeholder', 'Or reply directly…');
  await expect(card.getByRole('listbox')).toBeFocused();

  await shot(page, 'after-01-docked');

  // Keys only: 2 picks the portal, 1 picks the API back, Enter submits it.
  await page.keyboard.press('2');

  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('1');
  await shot(page, 'after-02-picked');
  await page.keyboard.press('Enter');

  await expect(page.getByText('Building the export in the Northwind API now.').last()).toBeVisible({ timeout: 120_000 });
  await expect(card).toHaveCount(0);

  const receipt = page.getByTestId('decision-answer').last();

  await expect(receipt).toContainText('Chose Northwind API');
  await expect(receipt).toContainText(QUESTION);
  // A click never becomes user text: no bubble says what they chose.
  await expect(page.locator('[data-testid="decision-answer"] + *').getByText('Northwind API', { exact: true })).toHaveCount(0);

  await shot(page, 'after-03-answered');

  await expect.poll(async () => {
    await page.reload();
    await page.getByText('Building the export in the Northwind API now.').last().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    return page.getByTestId('decision-answer').count();
  }, { timeout: 120_000 }).toBeGreaterThan(0);
  await expect(page.getByRole('dialog', { name: QUESTION })).toHaveCount(0);
  await expect(page.getByTestId('decision-answer').last()).toContainText('Chose Northwind API');
});

test('Esc folds the card away without answering; it opens again', async ({ page }) => {
  await signIn(page);
  await freshChat(page);
  await say(page, 'build the viewer export');
  const card = page.getByRole('dialog', { name: QUESTION });

  await expect(card).toBeVisible({ timeout: 120_000 });

  await card.getByRole('listbox').focus();
  await page.keyboard.press('Escape');

  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button', { name: /1 decision waiting/ })).toBeVisible();

  await shot(page, 'after-04-folded');
  await page.getByRole('button', { name: /1 decision waiting/ }).click();

  await expect(page.getByRole('dialog', { name: QUESTION })).toBeVisible();
});

test('an answer typed in the composer is read against the open Decision before it is routed', async ({ page }) => {
  await signIn(page);
  await freshChat(page);
  await say(page, 'build the viewer export');

  await expect(page.getByRole('dialog', { name: QUESTION })).toBeVisible({ timeout: 120_000 });

  await say(page, 'the second one');

  await expect(page.getByText('Building the export in the Northwind Portal, as you said.').last()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('dialog', { name: QUESTION })).toHaveCount(0);
  // Their words keep their bubble, and say which question they answered.
  await expect(page.getByText('the second one', { exact: true }).last()).toBeVisible();
  await expect(page.getByTestId('decision-answer').last()).toHaveAttribute('data-via', 'composer');

  await shot(page, 'after-05-answered-in-words');
});

test('what the person told it to do just runs: no card, one Done line named as they saw it, and its Undo takes it back', async ({ page }) => {
  await signIn(page);
  await freshChat(page);
  await say(page, 'add the software factory app');

  const done = page.getByTestId('done-receipts').locator('li').filter({ hasText: 'Add Software Factory' });

  await expect(done).toContainText('Done', { timeout: 120_000 });
  await expect(page.getByRole('dialog', { name: 'Add Software Factory' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60_000 });

  await shot(page, 'after-06-done-as-told');
  await done.getByRole('button', { name: 'Undo' }).click();

  await expect(done).toContainText('Undone', { timeout: 60_000 });
  await expect(done.getByRole('button', { name: 'Undo' })).toHaveCount(0);

  // Read back, it still says what it is now.
  await page.reload();

  await expect(page.getByTestId('done-receipts').locator('li').filter({ hasText: 'Add Software Factory' })).toContainText('Undone', { timeout: 60_000 });
});

test('the approval gate is the same card, asked as a permission prompt: the payload shown, Esc denies, typed', async ({ page }) => {
  await signIn(page);
  await freshChat(page);
  await say(page, 'send the northwind follow-up');

  const card = page.getByRole('dialog', { name: 'Send the follow-up to Northwind?' });

  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(card.getByTestId('decision-preview')).toContainText('pat@northwind.example');
  await expect(card.getByRole('option').first()).toContainText('Allow once');
  await expect(card.getByTestId('decision-key-hints')).toContainText('Esc deny');
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60_000 });

  await shot(page, 'after-07-gate');
  await card.getByRole('listbox').focus();
  await page.keyboard.press('Escape');

  await expect(page.getByText('Holding the follow-up; nothing went out.').last()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('decision-answer').last()).toContainText('Chose Deny');
  await expect(card).toHaveCount(0);
});
