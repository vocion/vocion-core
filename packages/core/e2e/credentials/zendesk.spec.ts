/**
 * A Zendesk OAuth client, end to end against the real app: the credential form
 * asks for the three values a client credentials grant needs and masks only
 * the secret, a value that could point the server at another host is refused
 * before anything is stored, a saved client never shows its secret again, a
 * Zendesk source is added with no settings, and Test connection answers an
 * unusable subdomain with a sentence rather than a call.
 *
 * Nothing here reaches Zendesk. A Test connection that passes needs a real
 * account, so that path is covered against a fake Zendesk in
 * `src/libs/sources/zendesk.test.ts` and the inspect route's own test.
 *
 * Self-seeding like the other credentials specs: it bootstraps its own admin
 * and workspace, and revokes the client a previous run saved.
 * Run with: npx playwright test --project=credentials e2e/credentials/zendesk.spec.ts
 */
import type { Locator, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { tolerateExistingUser } from '../../tests/TestUtils';

const ADMIN = {
  name: 'Zendesk Tester',
  account: 'Zendesk Credential Co',
  email: 'zendesk-creds@example.test',
  password: 'zendesk-credentials-e2e-1',
};

const CREDENTIAL_NAME = 'Zendesk Credential Co support';

/** Fixture values only: no Zendesk account has this client. */
const CLIENT = {
  subdomain: 'acme',
  clientId: 'vocion-e2e-client',
  clientSecret: 'zd-fixture-secret-not-real-7f3a',
};

/** Make this spec's admin and workspace, or keep the ones an earlier run made. */
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
        'tests/support/create-e2e-user.ts',
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
    tolerateExistingUser(error, '[zendesk credential spec]');
  }
}

/** Revoke the client an earlier run of this spec saved, so "Save key" is offered again. */
function revokeEarlierRunsClient(): void {
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
      'zendesk',
      '--name',
      CREDENTIAL_NAME,
    ],
    { stdio: ['ignore', 'inherit', 'pipe'] },
  );
}

/**
 * One try at opening the create form: true once its Platform select shows.
 *
 * On a cold server the Add credential button can paint before React wires its
 * handler, so a click can land and do nothing. That is why the caller polls
 * this rather than clicking once. A click that fails outright (the button
 * re-rendered under it) counts as "not open yet" for the next poll, rather
 * than failing the test.
 * @param addButton - The Add credential button.
 * @param platformSelect - The form's Platform select.
 */
async function tryOpeningCreateForm(addButton: Locator, platformSelect: Locator): Promise<boolean> {
  if (await platformSelect.isVisible()) {
    return true;
  }
  if (await addButton.isVisible()) {
    const clicked = await addButton.click({ timeout: 2_000 }).then(() => true, () => false);
    if (!clicked) {
      return false;
    }
  }
  return platformSelect.isVisible();
}

/**
 * Open the create form with Zendesk chosen.
 * @param page - The signed-in page, already on the credentials screen.
 */
async function openZendeskForm(page: Page): Promise<void> {
  const addButton = page.getByRole('button', { name: 'Add credential' });
  const platformSelect = page.getByLabel('Platform', { exact: true });

  await expect
    .poll(() => tryOpeningCreateForm(addButton, platformSelect), { timeout: 30_000, message: 'the create form never opened' })
    .toBe(true);

  await platformSelect.selectOption('zendesk');
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  createBootstrapAdmin();
  revokeEarlierRunsClient();
});

test.beforeEach(async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard**');
  await page.goto('/dashboard/api-tokens');

  await expect(page.getByText('API credentials', { exact: true })).toBeVisible();
});

test.describe('a Zendesk OAuth client', () => {
  test('is asked for as a subdomain, a client ID and a secret, with only the secret masked', async ({ page }) => {
    await openZendeskForm(page);

    await expect(page.getByLabel('Subdomain')).toHaveAttribute('type', 'text');
    await expect(page.getByLabel('Client ID')).toHaveAttribute('type', 'text');
    await expect(page.getByLabel('Client secret')).toHaveAttribute('type', 'password');
  });

  test('is refused when the subdomain is not one zendesk.com account, so the secret cannot be sent elsewhere', async ({ page }) => {
    await openZendeskForm(page);
    await page.getByLabel('Name').fill('Elsewhere');
    await page.getByLabel('Subdomain').fill('evil.com');
    await page.getByLabel('Client ID').fill(CLIENT.clientId);
    await page.getByLabel('Client secret').fill(CLIENT.clientSecret);
    await page.getByRole('button', { name: 'Save key' }).click();

    await expect(page.getByText(/does not look like a valid Subdomain/)).toBeVisible();
    await expect(page.getByRole('row', { name: /Elsewhere/ })).toHaveCount(0);
  });

  test('is saved with its secret masked, and the secret is never shown again', async ({ page }) => {
    await openZendeskForm(page);
    await page.getByLabel('Name').fill(CREDENTIAL_NAME);
    await page.getByLabel('Subdomain').fill('https://acme.zendesk.com/');
    await page.getByLabel('Client ID').fill(CLIENT.clientId);
    await page.getByLabel('Client secret').fill(CLIENT.clientSecret);
    await page.getByRole('button', { name: 'Save key' }).click();

    const row = page.getByRole('row', { name: new RegExp(CREDENTIAL_NAME) });

    await expect(row).toContainText('Zendesk');
    await expect(row).toContainText('…7f3a');
    await expect(row).toContainText('Active');
    await expect(page.locator('body')).not.toContainText(CLIENT.clientSecret);

    await page.reload();

    await expect(page.getByRole('row', { name: new RegExp(CREDENTIAL_NAME) })).toContainText('…7f3a');
    await expect(page.locator('body')).not.toContainText(CLIENT.clientSecret);
  });
});

test.describe('a Zendesk source', () => {
  test('is added with no settings, because the credential names the account', async ({ page }) => {
    const added = await page.request.post('/rpc/sources', { data: { kind: 'zendesk', configJson: {} } });

    expect(added.status()).toBe(200);

    const sources = await (await page.request.get('/rpc/sources')).json() as { sources: Array<{ kind: string }> };

    expect(sources.sources.some(source => source.kind === 'zendesk')).toBe(true);
  });

  test('answers Test connection for an unusable subdomain with a sentence the person can act on', async ({ page }) => {
    const tested = await page.request.post('/rpc/connectors/zendesk/inspect', {
      data: { config: {}, credentials: { ...CLIENT, subdomain: 'support.acme.com' } },
    });

    expect(tested.status()).toBe(400);
    await expect(tested.json()).resolves.toEqual({ error: expect.stringMatching(/before \.zendesk\.com.*Custom domains are not supported/) });
  });
});
