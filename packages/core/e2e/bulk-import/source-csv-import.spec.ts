import type { Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * CSV bulk import of sources, driven through the real dialog.
 *
 * Self-seeding, like the F1 tour: it needs a FRESH database (zero users),
 * creates the bootstrap admin with `src/scripts/create-local-user.ts` (the web
 * signup route is invite-only), then does the whole job an operator would —
 * download the template, upload files, read the preview, confirm.
 *
 * The uploads are held in memory rather than checked in as fixtures, so the
 * expected outcome for each file sits next to the file's own contents.
 *
 * Run from `packages/core`, with :5432 and :3008 free:
 *
 *   npx playwright test --project=bulk-import
 *
 * See e2e/tour/README.md for the environment those two ports need.
 */

/** The bootstrap admin — the only user on the fresh database. */
const ADMIN = {
  name: 'Import Operator',
  account: 'Import Co',
  email: 'operator@import.example',
  password: 'import-e2e-1',
};

/** The template's header row for the web connector. */
const WEB_HEADER = 'slug,url,crawl,max_depth,max_pages';

/**
 * Create the account, its default project and the admin straight in the
 * database — the same command an operator runs on a real box. The web route
 * cannot do it: accounts are invite-only and there is nobody to issue the
 * first invite on a fresh instance.
 */
function createBootstrapAdmin(): void {
  execFileSync(
    'npx',
    [
      'tsx',
      'src/scripts/create-local-user.ts',
      '--email',
      ADMIN.email,
      '--name',
      ADMIN.name,
      '--account',
      ADMIN.account,
      '--password',
      ADMIN.password,
      '--role',
      'admin',
    ],
    { stdio: 'inherit' },
  );
}

/**
 * A CSV upload, as Playwright's file chooser wants it.
 * @param name - Filename the browser reports.
 * @param rows - Body rows; the template's header is prepended.
 */
function csvUpload(name: string, rows: string[]) {
  return {
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from([WEB_HEADER, ...rows].join('\n'), 'utf8'),
  };
}

/**
 * Sign the admin in and land on the Sources page.
 * @param page - The test page.
 */
async function openSourcesPage(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard**');
  // eslint-disable-next-line playwright/no-networkidle -- one settle after the only full page load; every later step is assertion-gated
  await page.waitForLoadState('networkidle');

  await page.goto('/dashboard/sources');

  await expect(page.getByRole('button', { name: 'Add source' }).first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Open the Add-source dialog on a connector's "Import many" tab.
 * @param page - The test page.
 * @param connectorName - The picker tile to click, e.g. `Web URL`.
 */
async function openImportTab(page: Page, connectorName: string): Promise<void> {
  await page.getByRole('button', { name: 'Add source' }).first().click();
  await page.getByRole('button', { name: connectorName }).click();
  await page.getByRole('tab', { name: 'Import many' }).click();
}

test.beforeAll(() => {
  createBootstrapAdmin();
});

test.describe.configure({ mode: 'serial' });

test('a CSV of web URLs becomes one source per row, and a re-run changes nothing', async ({ page }) => {
  await openSourcesPage(page);

  /* ── The import tab is offered for web, and hands out a template ── */

  await openImportTab(page, 'Web URL');

  const templateDownload = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download CSV template' }).click(),
  ]);
  const templateStream = await templateDownload[0].createReadStream();
  const templateText = (await templateStream.toArray()).join('');

  expect(templateDownload[0].suggestedFilename()).toBe('web-sources-template.csv');
  expect(templateText.split('\n')[0]).toBe(WEB_HEADER);

  /* ── Five URLs across two hosts: five sources ── */

  const fiveUrls = csvUpload('five.csv', [
    ',https://docs.example.com/guide/intro,,,',
    ',https://docs.example.com/guide/setup,,,',
    ',https://docs.example.com/guide/faq,,,',
    ',https://help.example.org/start,,,',
    ',https://help.example.org/billing,,,',
  ]);

  await page.getByLabel('CSV file').setInputFiles(fiveUrls);

  await expect(page.getByTestId('import-summary')).toHaveText('5 will be added (5 rows read)');
  await expect(page.getByTestId('import-row-ok')).toHaveCount(5);

  await page.getByRole('button', { name: 'Add 5 sources' }).click();

  // Every row became its own source, with its own name — the whole point.
  for (const slug of [
    'web-docs-example-com-guide-intro',
    'web-docs-example-com-guide-setup',
    'web-docs-example-com-guide-faq',
    'web-help-example-org-start',
    'web-help-example-org-billing',
  ]) {
    await expect(page.getByRole('link', { name: slug })).toBeVisible();
  }

  /* ── The same file again: nothing is created, and it says so ── */

  await openImportTab(page, 'Web URL');
  await page.getByLabel('CSV file').setInputFiles(fiveUrls);

  await expect(page.getByTestId('import-summary')).toHaveText('0 will be added · 5 already configured (5 rows read)');
  await expect(page.getByRole('button', { name: 'Add sources' })).toBeDisabled();

  /* ── A file with problems: the good rows still import ── */

  await page.getByLabel('CSV file').setInputFiles(csvUpload('mixed.csv', [
    ',https://new.example.com/one,,,',
    ',,true,,',
    ',https://new.example.com/two,,,abc',
    ',https://new.example.com/three,,,',
    ',https://new.example.com/three,,,',
    ',https://docs.example.com/guide/intro,,,',
  ]));

  await expect(page.getByTestId('import-summary'))
    .toHaveText('2 will be added · 2 not valid · 1 duplicated in the file · 1 already configured (6 rows read)');
  // Each problem is named on its own row, by the column it is in.
  await expect(page.getByText('"url" is required')).toBeVisible();
  await expect(page.getByText('"max_pages" must be a number, got "abc"')).toBeVisible();

  await page.getByRole('button', { name: 'Add 2 sources' }).click();

  await expect(page.getByRole('link', { name: 'web-new-example-com-one' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'web-new-example-com-three' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'web-new-example-com-two' })).toHaveCount(0);

  /* ── A file that is not a CSV at all is refused, not crashed on ── */

  await openImportTab(page, 'Web URL');
  await page.getByLabel('CSV file').setInputFiles({
    name: 'screenshot.png',
    mimeType: 'image/png',
    buffer: Buffer.from('\x89PNG\r\n\x1A\nnot a spreadsheet', 'binary'),
  });

  // Scoped by its text rather than by role: Next's route announcer is also an
  // alert, so `getByRole('alert')` alone matches two elements.
  await expect(page.getByText('Download the template for this source type')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add sources' })).toBeDisabled();

  /* ── Both limits are refused with the limit named ── */

  await page.getByLabel('CSV file').setInputFiles(csvUpload('too-many.csv', Array.from({ length: 1001 }, (_, index) => `,https://bulk.example/p${index},,,`)));

  await expect(page.getByText('over the 1000-row limit')).toBeVisible();

  await page.getByLabel('CSV file').setInputFiles({
    name: 'huge.csv',
    mimeType: 'text/csv',
    buffer: Buffer.alloc(2 * 1_048_576, 'a'),
  });

  await expect(page.getByText('larger than the 1 MB limit')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add sources' })).toBeDisabled();
});

test('a connector that takes no import is not offered one', async ({ page }) => {
  await openSourcesPage(page);
  await page.getByRole('button', { name: 'Add source' }).first().click();
  await page.getByRole('button', { name: 'Strapi' }).click();

  await expect(page.getByRole('tab', { name: 'Import many' })).toHaveCount(0);
});
