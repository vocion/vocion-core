import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { tolerateExistingUser } from '../../tests/TestUtils';

/**
 * Whose key a paid tool spends, end to end (VEERIO-171).
 *
 * The Tools page is the only place a workspace admin ever learns that web
 * search is about to bill *their* Tavily account rather than the deployment's.
 * That line is produced by a chain — credential saved, vault opened, provider
 * status read, card re-rendered — and a break anywhere in it fails silently:
 * the page still renders, still looks fine, and quietly names the wrong payer.
 * So this walks the whole chain through the UI rather than trusting the unit
 * tests under it.
 *
 * Its own admin and account, deliberately: the sibling credentials spec drives
 * the same screens, and a shared workspace would let one spec's saved key
 * decide the other's assertions.
 *
 * No live provider is called — the key is a well-shaped fake that is only
 * stored and masked.
 *
 * Run with: npx playwright test --project=credentials
 */

const ADMIN = {
  name: 'Tool Key Tester',
  account: 'Tool Key Co',
  email: 'toolkeys@example.test',
  password: 'tool-keys-e2e-1',
};

/** A well-shaped fake. Never sent anywhere — only stored and masked. */
const TAVILY_KEY = 'tvly-abcdefghijklmnop';

/** What the card says when the workspace is paying. */
const WORKSPACE_PAYS = 'On this workspace\'s key';

function createBootstrapAdmin(): void {
  try {
    // Through `dotenv -c` so the script sees .env.local — it is run outside the
    // Next process, which is the only thing that loads that file on its own.
    execFileSync(
      'npx',
      [
        'dotenv',
        '-c',
        '--',
        'npx',
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
      { stdio: ['ignore', 'inherit', 'pipe'] },
    );
  } catch (error) {
    tolerateExistingUser(error, '[tool provider keys spec]');
  }
}

/**
 * The Tools page card for one built-in tool, found by the tool name it prints
 * in monospace — the one label on the card that cannot drift with copy edits.
 * @param page - The signed-in page, already on the Tools screen.
 * @param toolName - The tool's catalog name, e.g. `web_search`.
 */
function toolCard(page: Page, toolName: string) {
  return page.getByRole('link').filter({ hasText: toolName }).first();
}

/**
 * Open the create form on the credentials screen and choose a platform.
 * @param page - The signed-in page, already on the credentials screen.
 * @param platformId - Value of the platform option to select.
 */
async function openFormFor(page: Page, platformId: string): Promise<void> {
  const addButton = page.getByRole('button', { name: 'Add credential' });
  const platformSelect = page.getByLabel('Platform', { exact: true });

  // Poll rather than click-once, for the reason the sibling spec spells out:
  // on a cold dev server the button paints before React wires its handler, so
  // the first click is swallowed silently.
  await expect
    .poll(async () => {
      if (await platformSelect.isVisible().catch(() => false)) {
        return true;
      }
      if (await addButton.isVisible().catch(() => false)) {
        await addButton.click().catch(() => {});
      }
      return platformSelect.isVisible().catch(() => false);
    }, { timeout: 30_000, message: 'the create form never opened' })
    .toBe(true);

  await platformSelect.selectOption(platformId);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  createBootstrapAdmin();
});

test.beforeEach(async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard**');
});

test.describe('the Tools page names whose key a paid tool spends', () => {
  test('a workspace with no key of its own is never told it is paying', async ({ page }) => {
    await page.goto('/dashboard/tools');

    const webSearch = toolCard(page, 'web_search');

    await expect(webSearch).toBeVisible();
    // Tavily is the default provider, and it is the one the next test buys a
    // key for. If this ever reads `brave`, that test is keying the wrong
    // platform and its green is meaningless.
    await expect(webSearch).toContainText('tavily');
    await expect(webSearch).not.toContainText(WORKSPACE_PAYS);
  });

  test('storing the workspace\'s own Tavily key moves web search onto it', async ({ page }) => {
    await page.goto('/dashboard/api-tokens');
    await openFormFor(page, 'tavily');
    await page.getByLabel('Name').fill('Tool Key Co Tavily');
    await page.getByLabel('Tavily key').fill(TAVILY_KEY);
    await page.getByRole('button', { name: 'Save key' }).click();

    await expect(page.getByRole('cell', { name: 'Tool Key Co Tavily' })).toBeVisible();

    await page.goto('/dashboard/tools');

    const webSearch = toolCard(page, 'web_search');

    await expect(webSearch).toContainText(WORKSPACE_PAYS);
    // Ready as well as workspace-funded: a stored key is what makes the
    // capability usable on a deployment that holds no server key at all.
    await expect(webSearch).toContainText('Ready');
  });

  test('a tool that spends nobody\'s key still says nothing about payment', async ({ page }) => {
    await page.goto('/dashboard/tools');

    // create_artifact is builtin — it calls no paid provider, so naming a payer
    // on its card would be wrong however the org's credentials are set up.
    const artifact = toolCard(page, 'create_artifact');

    await expect(artifact).toContainText('Ready');
    await expect(artifact).not.toContainText(WORKSPACE_PAYS);
    await expect(artifact).not.toContainText('On the Vocion server key');
  });
});
