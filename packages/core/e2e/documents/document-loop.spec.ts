import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { tolerateExistingUser } from '../../tests/TestUtils';

/**
 * The document loop, as a person runs it — chat beside the document, edited
 * by chat, verified after every change — replayed against a SCRIPTED model.
 *
 * `e2e/documents/scripts/proposal-loop.json` is the agent's part: what it
 * calls and what it says for each line the person types. Everything else is
 * real: the artifact rows, the versions, real Chromium rendering every sheet,
 * the footer audit, the PDF page count, the pane. A screenshot is attached at
 * every step, so a run's report is the storyboard of the use case.
 *
 * The server has to be started with the scripted model and the sample
 * workspace on the path (`npm run e2e:documents` does both):
 *   VOCION_LLM_PROVIDER=scripted
 *   VOCION_LLM_SCRIPT=e2e/documents/scripts/proposal-loop.json
 *   WORKSPACE_PATH=templates/workspaces/client-documents
 *
 * Self-seeding like the other e2e projects: a fresh database gets an admin
 * (`create-local-user.ts`) and the sample workspace applied to their project.
 * Set `E2E_DOCUMENTS_EMAIL` / `E2E_DOCUMENTS_PASSWORD` to run against a
 * database whose user and workspace already exist (a local dev server).
 */

const ADMIN = {
  name: 'Pat Reyes',
  account: 'Metacto',
  email: process.env.E2E_DOCUMENTS_EMAIL ?? 'documents@example.test',
  password: process.env.E2E_DOCUMENTS_PASSWORD ?? 'documents-e2e-1',
};
const PRESEEDED = Boolean(process.env.E2E_DOCUMENTS_EMAIL);
const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'test-results', 'documents');

function run(args: string[]): void {
  execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', ...args], { cwd: ROOT, stdio: ['ignore', 'inherit', 'pipe'], env: process.env });
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
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
});

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);

  await expect(page.getByRole('link', { name: 'Chat' }).first()).toBeVisible();
}

/**
 * Type a line, send it, and wait for the agent's scripted reply to land.
 * @param page
 * @param line
 * @param replyContains
 */
async function say(page: Page, line: string, replyContains: string) {
  const box = page.locator('textarea').last();
  await box.click();
  await box.fill(line);
  await page.getByRole('button', { name: 'Send message' }).last().click();

  await expect(page.getByText(replyContains).last()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60_000 });
}

async function shot(page: Page, name: string) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: file });

  await test.info().attach(name, { path: file, contentType: 'image/png' });
}

test.describe('the document loop, by chat', () => {
  test.describe.configure({ mode: 'serial' });

  test.setTimeout(240_000);

  test('draft → the document opens beside the chat, render-verified', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Chat' }).first().click();
    await page.waitForURL(/\/dashboard\/chat/);

    await expect(page.locator('textarea').last()).toBeEditable({ timeout: 30_000 });

    await shot(page, '01-chat-empty');

    await say(page, 'Draft the proposal for Northwind from its data room.', 'The proposal is open beside you');
    // The turn made two tool calls (render, then the fix) and one artifact at v2.
    const chip = page.locator('[data-artifact-chip]').first();

    await expect(chip).toContainText('Northwind - Hiring Agents Proposal');
    await expect(chip).toContainText('v2');
    await expect(page.getByText('Worked it out · 2 steps')).toBeVisible();

    await shot(page, '02-chat-after-draft');

    // Expand: the transcript beside the document itself. The artifacts log
    // links every row to the conversation it came out of.
    const chipId = await chip.getAttribute('data-artifact-chip');
    const { conversation, artifactId } = await latestDocument(page);

    expect(artifactId).toBe(chipId);

    await page.goto(`/dashboard/chat/${conversation}?artifact=${artifactId}`);

    await expect(page.locator('[data-document-frame]')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-document-state]')).toHaveText('5 sheets · verified');
    await expect(page.locator('[data-artifact-version]')).toContainText('v2');

    await shot(page, '03-side-by-side');
  });

  test('edit by chat: three agents, price per opening, cut a page — each re-verified', async ({ page }) => {
    await signIn(page);
    const { conversation, artifactId } = await latestDocument(page);
    await page.goto(`/dashboard/chat/${conversation}?artifact=${artifactId}`);

    await expect(page.locator('[data-document-frame]')).toBeVisible({ timeout: 60_000 });

    await say(page, 'Make it three agents.', 'Added the Offer Coordinator');

    await expect(page.locator('[data-artifact-version]')).toContainText('v3');
    await expect(page.locator('[data-document-state]')).toHaveText('6 sheets · verified');

    await shot(page, '04-three-agents');

    await say(page, 'Price it per opening.', 'per open role per month');

    await expect(page.locator('[data-artifact-version]')).toContainText('v4');
    await expect(page.locator('[data-document-state]')).toHaveText('6 sheets · verified');

    await shot(page, '05-price-per-opening');

    await say(page, 'Cut page 2.', 'Cut the How it works sheet');

    await expect(page.locator('[data-artifact-version]')).toContainText('v5');
    await expect(page.locator('[data-document-state]')).toHaveText('5 sheets · verified');

    await shot(page, '06-cut-page-2');
  });

  test('highlight → Change: a passage selected in the document reaches the composer quoted', async ({ page }) => {
    await signIn(page);
    const { conversation, artifactId } = await latestDocument(page);
    await page.goto(`/dashboard/chat/${conversation}?artifact=${artifactId}`);
    const frame = page.frameLocator('[data-document-iframe]');

    await expect(frame.locator('.sheet').first()).toBeVisible({ timeout: 60_000 });

    // Select the sentence inside the sandboxed frame; the bridge posts it up.
    const target = frame.locator('.drow', { hasText: 'Will not do' }).first();
    await target.scrollIntoViewIfNeeded();
    await target.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const control = page.locator('[data-document-selection-control]');

    await expect(control).toBeVisible();

    await shot(page, '07-highlight-control');

    await control.getByRole('button', { name: 'Change' }).click();
    const box = page.locator('textarea').last();

    await expect(box).toHaveValue(/Change this: /);

    await shot(page, '08-change-prefilled');
    await box.fill('Change this: split the sentence into two.');
    await page.getByRole('button', { name: 'Send message' }).last().click();

    await expect(page.getByText('Split that sentence').last()).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('[data-artifact-version]')).toContainText('v6');
    await expect(frame.locator('.drow', { hasText: 'The agent flags. The Northwind team decides.' }).first()).toBeVisible();

    await shot(page, '09-after-change');
  });

  test('export: the PDF is filed beside the document, named from its title', async ({ page }) => {
    await signIn(page);
    const { conversation, artifactId } = await latestDocument(page);
    await page.goto(`/dashboard/chat/${conversation}?artifact=${artifactId}`);

    await expect(page.locator('[data-document-frame]')).toBeVisible({ timeout: 60_000 });

    await say(page, 'Export the PDF.', 'The PDF is filed beside the document');
    const pdfChip = page.locator('[data-artifact-chip]', { hasText: '.pdf' }).last();

    await expect(pdfChip).toContainText('Northwind - Hiring Agents Proposal (Metacto) v1.0.pdf');

    await shot(page, '10-pdf-exported');
  });
});

/**
 * The newest document artifact and the conversation it lives in, via the artifacts log.
 * @param page
 */
async function latestDocument(page: Page): Promise<{ conversation: string; artifactId: string }> {
  await page.goto('/dashboard/artifacts');
  const row = page.locator('a[href*="/dashboard/chat/"][href*="artifact="]').first();

  await expect(row).toBeVisible({ timeout: 30_000 });

  const href = await row.getAttribute('href');
  const m = /\/dashboard\/chat\/(\d+)\?artifact=(\d+)/.exec(href ?? '');
  if (!m) {
    throw new Error(`unexpected artifact row href: ${href}`);
  }
  return { conversation: m[1]!, artifactId: m[2]! };
}
