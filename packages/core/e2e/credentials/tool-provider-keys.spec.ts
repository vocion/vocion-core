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

/** What the second test names the credential it saves. */
const CREDENTIAL_NAME = 'Tool Key Co Tavily';

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
 * Revoke the Tavily key a previous run of this spec left behind.
 *
 * The database a spec runs against is usually the one it ran against last
 * time — `createBootstrapAdmin` tolerating an existing user is the same
 * assumption. The first test here asserts this workspace has no key of its
 * own, and the second saves one, so without this the spec passes once and
 * fails every run after, looking exactly like a regression in the page.
 */
function clearKeyFromEarlierRuns(): void {
  execFileSync(
    'npx',
    [
      'dotenv',
      '-c',
      '--',
      'npx',
      'tsx',
      'e2e/credentials/support/revoke-stored-credentials.ts',
      '--platform',
      'tavily',
      '--name',
      CREDENTIAL_NAME,
    ],
    { stdio: ['ignore', 'inherit', 'pipe'] },
  );
}

/**
 * Make the saved Tavily key undecryptable, the way a rotated vault key does.
 */
function breakStoredKey(): void {
  execFileSync(
    'npx',
    [
      'dotenv',
      '-c',
      '--',
      'npx',
      'tsx',
      'e2e/credentials/support/scramble-stored-credential.ts',
      '--platform',
      'tavily',
      '--name',
      CREDENTIAL_NAME,
    ],
    { stdio: ['ignore', 'inherit', 'pipe'] },
  );
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
  clearKeyFromEarlierRuns();
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
    await page.getByLabel('Name').fill(CREDENTIAL_NAME);
    await page.getByLabel('Tavily key').fill(TAVILY_KEY);
    await page.getByRole('button', { name: 'Save key' }).click();

    await expect(page.getByRole('cell', { name: CREDENTIAL_NAME })).toBeVisible();

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

test.describe('a key the workspace holds but nobody can read', () => {
  test('admits it could not check, and will not offer to overwrite', async ({ page }) => {
    // The dangerous version of this state: the lookup fails, the page reads it
    // as "no key here", and the card then offers a plain Save — which revokes
    // the key that is actually on file, without the replace warning, because
    // as far as the card knows there is nothing to replace. On the image page
    // that is the credential every chat and embedding call spends.
    // The key the previous test saved is still on file — this file runs
    // serially, and that is the credential being broken here.
    breakStoredKey();

    await page.goto('/dashboard/tools/web_search');

    await expect(page.getByText(/could not be read just now/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save key' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Replace key' })).toHaveCount(0);
    // And the badge must not say "Needs key" either. An admin who reads that
    // stores a second key, which lands beside the unreadable one and changes
    // nothing, because the call path still refuses rather than falling back.
    await expect(page.getByText('Can\'t check')).toBeVisible();
    await expect(page.getByText('Needs key')).toHaveCount(0);
  });

  test('names no payer on the list page either', async ({ page }) => {
    // The badge and the payer line are read together. "Ready · On the Vocion
    // server key" here would contradict every search the workspace runs, since
    // the call refuses outright rather than falling back.
    await page.goto('/dashboard/tools');

    const webSearch = toolCard(page, 'web_search');

    await expect(webSearch).toContainText('Could not check');
    await expect(webSearch).toContainText('Can\'t check');
    await expect(webSearch).not.toContainText('Needs key');
    await expect(webSearch).not.toContainText(WORKSPACE_PAYS);
    await expect(webSearch).not.toContainText('On the Vocion server key');
  });
});
