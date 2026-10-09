import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { docx, leadRows, workbook } from '../../src/services/chat/officeFixtures';

/**
 * FILES IN CHAT (founder, 2026-10-09: "xlsx upload failed, also chat should
 * have a much bigger file drop zone").
 *
 * 1. A file held ANYWHERE over the conversation — far from the composer —
 *    shows one calm "Drop to attach" overlay across the pane.
 * 2. The drop lands as chips: a progress bar while the bytes go up, then the
 *    file's name and what it is in words ("Excel spreadsheet"), with an ×.
 *    The Excel file goes through the real upload route and its conversion.
 * 3. An unreadable file and an oversized one are each one plain line — no
 *    MIME type.
 * 4. The + button's file picker still attaches, on a phone too.
 *
 * The drag is dispatched with a real `DataTransfer` holding real `File`s,
 * which is what a drag from the desktop gives the page; Playwright cannot
 * drive the OS file manager. Self-seeding
 * (`support/seed-attachments-fixtures.ts`). No model is involved: nothing is sent.
 */

const SEED_SCRIPT = 'e2e/attachments/support/seed-attachments-fixtures.ts';
// Must match the seed script.
const PERSON = { email: 'attachments@e2e.example', password: 'attachments-e2e-pass-1' };
const CHAT = '/w/e2e-attach-home/dashboard/chat';

test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', SEED_SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(PERSON.email);
  await page.getByLabel('Password', { exact: true }).fill(PERSON.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
});

test.afterAll(async () => {
  await page.close();
});

type FileSpec = { name: string; base64?: string; size?: number; type?: string };

/**
 * Fire a drag event carrying files at an element, as a drag from the desktop would.
 * @param selector - Where the pointer is.
 * @param type - The drag event.
 * @param files - The files held; `size` alone makes an empty file of that size.
 */
async function dragFiles(selector: string, type: 'dragenter' | 'dragover' | 'dragleave' | 'drop', files: FileSpec[]) {
  await page.locator(selector).first().evaluate((el, { type, files }) => {
    const dt = new DataTransfer();
    for (const f of files) {
      const bytes = f.base64 ? Uint8Array.from(atob(f.base64), c => c.charCodeAt(0)) : new Uint8Array(f.size ?? 1);
      dt.items.add(new File([bytes], f.name, { type: f.type ?? '' }));
    }
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: rect.left + 40, clientY: rect.top + 40 }));
  }, { type, files });
}

async function openChat() {
  await page.goto(CHAT);

  await expect(page.getByRole('textbox', { name: /ask|message/i }).or(page.locator('textarea[data-agent-composer]')).first()).toBeVisible();
}

test('a file held anywhere over the conversation shows "Drop to attach"; the drop lands as chips', async ({}, testInfo) => {
  await openChat();
  const leads = (await workbook({ Leads: leadRows(4000) })).toString('base64');
  const plan = (await docx()).toString('base64');
  const files: FileSpec[] = [
    { name: 'Export-All-Leads.xlsx', base64: leads, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { name: 'Renewal plan.docx', base64: plan, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  ];

  // Held over the TOP of the pane — the greeting, nowhere near the composer.
  const zone = '[data-testid="chat-drop-zone"]';
  const overlay = page.getByTestId('chat-drop-overlay');

  // Until the page has hydrated nothing listens; hold the files again until it does.
  await expect(async () => {
    await dragFiles(zone, 'dragenter', files);
    await dragFiles(zone, 'dragover', files);

    await expect(overlay).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await expect(overlay).toContainText('Drop to attach');

  // The overlay covers the conversation pane, not just the composer.
  const paneBox = (await page.locator(zone).first().boundingBox())!;
  const overlayBox = (await overlay.boundingBox())!;

  expect(overlayBox.height).toBeGreaterThan(paneBox.height * 0.9);
  expect(overlayBox.width).toBeGreaterThan(paneBox.width * 0.9);

  await page.screenshot({ path: testInfo.outputPath('drop-overlay.png') });

  // Slow the upload so the bars are on screen long enough to see.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: -1, uploadThroughput: 48 * 1024 });

  await dragFiles(zone, 'drop', files);

  await expect(overlay).toBeHidden();

  const uploading = page.getByTestId('composer-uploading');

  await expect(uploading).toHaveCount(2);
  await expect(uploading.first()).toContainText('Export-All-Leads.xlsx');
  await expect(page.getByRole('progressbar', { name: 'Uploading Export-All-Leads.xlsx' })).toBeVisible();
  // Send waits for the files.
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();

  await page.waitForFunction(() => {
    const bar = document.querySelector('[role="progressbar"][aria-label="Uploading Export-All-Leads.xlsx"]');
    const v = Number(bar?.getAttribute('aria-valuenow') ?? 0);
    return v >= 15 && v <= 85;
  }, undefined, { timeout: 30_000 });
  await page.locator('[data-testid="composer-uploading"]').first().screenshot({ path: testInfo.outputPath('chip-uploading.png') });
  await page.screenshot({ path: testInfo.outputPath('chips-uploading.png') });

  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  const chips = page.getByTestId('composer-attachment');

  await expect(chips).toHaveCount(2, { timeout: 60_000 });
  await expect(chips.nth(0)).toContainText('Export-All-Leads.xlsx');
  await expect(chips.nth(0)).toContainText('Excel spreadsheet');
  await expect(chips.nth(1)).toContainText('Renewal plan.docx');
  await expect(chips.nth(1)).toContainText('Word document');
  await expect(page.getByTestId('attach-error')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();

  await page.screenshot({ path: testInfo.outputPath('chips-attached.png') });
  await page.locator('textarea[data-agent-composer]').locator('xpath=ancestor::form/..').screenshot({ path: testInfo.outputPath('composer-chips.png') });

  // The × takes one off.
  await page.getByRole('button', { name: 'Remove Renewal plan.docx' }).click();

  await expect(chips).toHaveCount(1);
});

test('an unreadable file and an oversized one are each one plain line, never a MIME type', async ({}, testInfo) => {
  await openChat();
  const zone = '[data-testid="chat-drop-zone"]';
  const error = page.getByTestId('attach-error');

  await expect(async () => {
    await dragFiles(zone, 'dragenter', [{ name: 'Q4 board.key', size: 2048 }]);
    await dragFiles(zone, 'drop', [{ name: 'Q4 board.key', size: 2048, type: 'application/x-iwork-keynote-sffkey' }]);

    await expect(error).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });

  await expect(error).toHaveText('Vocion can\'t read .key files yet. Export it as PDF or PowerPoint.');

  await page.screenshot({ path: testInfo.outputPath('refused-key.png') });

  await dragFiles(zone, 'dragenter', [{ name: 'Export-All-Leads.xlsx', size: 26 * 1024 * 1024 }]);
  await dragFiles(zone, 'drop', [{ name: 'Export-All-Leads.xlsx', size: 26 * 1024 * 1024 }]);

  await expect(error).toHaveText('Export-All-Leads.xlsx is 26 MB. Files can be up to 25 MB.');
  await expect(error).not.toContainText('application/');
  await expect(page.getByTestId('composer-uploading')).toHaveCount(0);
});

test('the + button still attaches, on a phone too', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat();
  const leads = await workbook({ Leads: leadRows(3) }, 'ods');

  // Until the page has hydrated the input has no listener; pick the file again until it does.
  await expect(async () => {
    await page.getByTestId('composer-file-input').setInputFiles({ name: 'leads.ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet', buffer: leads });

    await expect(page.getByTestId('composer-attachment').or(page.getByTestId('composer-uploading')).first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });

  await expect(page.getByTestId('composer-attachment').first()).toContainText('leads.ods');
  await expect(page.getByTestId('composer-attachment').first()).toContainText('OpenDocument spreadsheet');
  await expect(page.getByTestId('composer-attach')).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
});
