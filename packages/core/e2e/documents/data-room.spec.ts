import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { ADMIN, seedDocumentsWorkspace } from './support/seed';

/**
 * The data room, as a person runs it — opened by chat, a transcript filed
 * into it by match with a decision log on top, the room page reading like the
 * README it replaces, and the proposal drafted FROM the room page so the
 * document is anchored to the engagement. Same scripted agent as
 * `document-loop.spec.ts`; same server; run after it or on its own.
 *
 * Deliberately covers the confidence rule: the transcript names no room, and
 * is filed because its attendee domain and title match one room clearly.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'test-results', 'documents');

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);

  await expect(page.getByRole('link', { name: 'Chat' }).first()).toBeVisible();
}

async function say(page: Page, line: string, replyContains: string) {
  const box = page.locator('textarea[data-agent-composer]').last();
  await box.click();
  await box.fill(line);
  await page.getByRole('button', { name: 'Send message' }).last().click();

  await expect(page.getByText(replyContains).last()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60_000 });
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });

  await test.info().attach(name, { path: file, contentType: 'image/png' });
}

test.beforeAll(() => {
  // Same admin, workspace and fixtures as document-loop.spec — either spec may
  // run first. Then the room this spec opens is removed, or the filing step
  // would (correctly) refuse to choose between two rooms by the same name.
  seedDocumentsWorkspace();
  execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', 'e2e/documents/support/reset-rooms.ts'], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
});

test.describe('the data room, by chat', () => {
  test.describe.configure({ mode: 'serial' });

  test.setTimeout(240_000);

  test('open a room, file a transcript by match, read the room', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Chat' }).first().click();
    await page.waitForURL(/\/dashboard\/chat/);

    await expect(page.locator('textarea[data-agent-composer]').last()).toBeEditable({ timeout: 30_000 });

    await say(page, 'Open a data room for Northwind from the third call.', 'Opened the data room for Northwind');
    await say(page, 'File the third call transcript.', 'Filed the third call into');
    await shot(page, '11-room-by-chat');

    // The rooms list (under Knowledge in the sidebar; reached by URL here), then the room.
    await page.goto('/dashboard/rooms');
    const row = page.getByRole('link', { name: /Northwind — Hiring agents/ }).first();

    await expect(row).toBeVisible();

    await shot(page, '12-rooms-list');
    await row.click();
    await page.waitForURL(/\/dashboard\/rooms\/\d+$/);

    await expect(page.getByTestId('data-room-page')).toBeVisible();
    await expect(page.getByText('volume corrected to ~20 openings a month')).toBeVisible();

    // The transcript, at three stars, filed via zoom on the call's date.
    const sources = page.getByTestId('room-sources');

    await expect(sources.getByText('Third call — Amy Larkin')).toBeVisible();
    await expect(sources.getByText('⭐⭐⭐')).toBeVisible();
    await expect(sources.getByText(/via zoom/)).toBeVisible();
    // The urgent open item, and the cast.
    await expect(page.getByTestId('room-open-items').getByText('Reprice the proposal per open role at the typical 20')).toBeVisible();
    await expect(page.getByLabel('urgent')).toBeVisible();
    await expect(page.getByText('Amy Larkin', { exact: true })).toBeVisible();
    // The decision log filed with it.
    await expect(page.getByRole('link', { name: /Third call — Amy Larkin — decision log/ })).toBeVisible();

    await shot(page, '13-room-page');
  });

  test('the LLM-context bundle is the room as markdown, sources by weight first', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard/rooms');
    const href = await page.getByRole('link', { name: /Northwind — Hiring agents/ }).first().getAttribute('href');
    const id = /\/rooms\/(\d+)/.exec(href ?? '')?.[1];

    expect(id).toBeTruthy();

    const res = await page.request.get(`/api/v1/rooms/${id}/export`);

    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toContain('text/markdown');

    const md = await res.text();

    expect(md).toContain('# Northwind — Hiring agents — data room');
    expect(md).toContain('> **Status as of');
    expect(md).toContain('## Cast');
    expect(md).toContain('| Amy Larkin | VP People | amy@northwind.example | client |');
    expect(md).toContain('## Sources');
    expect(md).toContain('⭐⭐⭐ **2026-09-16** · Third call — Amy Larkin — transcript via zoom');
    expect(md).toContain('## Open items');
    expect(md).toContain('🔴 Reprice the proposal per open role');
    expect(md).toContain('## Decisions and corrections');
  });

  test('draft from the room page: the document is anchored to the engagement', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard/rooms');
    await page.getByRole('link', { name: /Northwind — Hiring agents/ }).first().click();
    await page.waitForURL(/\/dashboard\/rooms\/\d+$/);
    // "Draft a document" opens the rail with the prompt prefilled, scoped to the room.
    await page.getByRole('button', { name: 'Draft a document' }).click();
    const box = page.locator('textarea[data-agent-composer]').last();

    await expect(box).toHaveValue(/Draft the proposal/, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Send message' }).last().click();

    await expect(page.getByText('The proposal is open beside you').last()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60_000 });

    await shot(page, '14-draft-from-room');

    await page.reload();
    const docs = page.getByTestId('room-documents');

    await expect(docs.getByText('Northwind - Hiring Agents Proposal (Metacto) v1.0')).toBeVisible({ timeout: 30_000 });
    await expect(docs.getByText('5 sheets · verified')).toBeVisible();

    await shot(page, '15-room-with-document');
  });
});
