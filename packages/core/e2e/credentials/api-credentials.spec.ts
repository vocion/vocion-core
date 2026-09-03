import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * API credentials page — the platform matrix, end to end.
 *
 * The page now holds two credentials that behave almost oppositely: a Vocion
 * token we mint and set an expiry on, and a key the customer pastes that we
 * only ever store. Nearly every bug available here is a place where one of
 * those rules leaks onto the other kind, so that is what this spec walks:
 * which controls appear per platform, which values are refused, what the list
 * shows afterwards, and what happens when a platform already holds a key.
 *
 * Self-seeding, like the tour spec: a fresh PGlite dev server has zero users,
 * so it bootstraps the admin with `create-local-user.ts` (the web signup route
 * is invite-only). No live provider is ever called — every key here is a
 * well-shaped fake.
 *
 * Run with: npx playwright test --project=credentials
 */

const ADMIN = {
  name: 'Credential Tester',
  account: 'Credential Co',
  email: 'creds@example.test',
  password: 'credentials-e2e-1',
};

/** Well-shaped fakes. Never sent anywhere — only stored and masked. */
const KEYS = {
  openai: 'sk-abcdefghijklmnop1234',
  openaiReplacement: 'sk-zzzzzzzzzzzzzzzz9999',
  anthropic: 'sk-ant-abcdefghijklmnop1234',
  azure: 'a'.repeat(32),
  awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  awsSecret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  custom: 'whatever-my-vendor-issued',
};

function createBootstrapAdmin(): void {
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
    { stdio: 'inherit' },
  );
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
  await page.goto('/dashboard/api-tokens');

  // Not getByRole('heading'): TitleBar renders the page title as a styled
  // <div>, so there is no heading role to target. Pre-existing across every
  // dashboard page — noted, not this spec's problem to fix.
  await expect(page.getByText('API credentials', { exact: true })).toBeVisible();
});

/**
 * Open the create form and choose a platform.
 * @param page - The signed-in page, already on the credentials screen.
 * @param platformId - Value of the platform option to select.
 */
async function openFormFor(page: import('@playwright/test').Page, platformId: string): Promise<void> {
  const addButton = page.getByRole('button', { name: 'Add credential' });
  const platformSelect = page.getByLabel('Platform', { exact: true });

  // Poll rather than click-once: on a cold dev server the button can be
  // painted before React has wired its handler, so the first click is
  // swallowed silently. Re-clicking until the form is actually up is the
  // difference between a flaky suite and a deterministic one.
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

test.describe('the platform selector decides which controls exist', () => {
  test('offers every platform this build supports', async ({ page }) => {
    await openFormFor(page, 'vocion');

    await expect(page.getByLabel('Platform', { exact: true }).locator('option')).toHaveText([
      'Vocion',
      'OpenAI',
      'Anthropic',
      'Google Vertex AI',
      'Azure OpenAI',
      'AWS',
      'Other platform',
    ]);
  });

  test('only the Vocion token can be given an expiry', async ({ page }) => {
    await openFormFor(page, 'vocion');

    await expect(page.getByLabel('Expires')).toBeVisible();

    for (const platformId of ['openai', 'anthropic', 'vertex', 'azure-openai', 'aws', 'custom']) {
      await page.getByLabel('Platform').selectOption(platformId);

      await expect(page.getByLabel('Expires')).toHaveCount(0);
      await expect(page.getByText('No expiry to set')).toBeVisible();
    }

    // And back again — the control returns for Vocion.
    await page.getByLabel('Platform').selectOption('vocion');

    await expect(page.getByLabel('Expires')).toBeVisible();
  });

  test('Vocion asks for no key, because it mints one', async ({ page }) => {
    await openFormFor(page, 'vocion');

    await expect(page.getByPlaceholder('Paste the value')).toHaveCount(0);
  });

  test('AWS asks for a pair, and masks only the secret half', async ({ page }) => {
    await openFormFor(page, 'aws');

    await expect(page.getByLabel('Access key ID')).toHaveAttribute('type', 'text');
    await expect(page.getByLabel('Secret access key')).toHaveAttribute('type', 'password');
    await expect(page.getByText(/AWS services like Bedrock/)).toBeVisible();
  });

  test('single-secret platforms ask for exactly one masked field', async ({ page }) => {
    for (const [platformId, label] of [
      ['openai', 'OpenAI key'],
      ['anthropic', 'Anthropic key'],
      ['azure-openai', 'Azure OpenAI key'],
      ['vertex', 'Vertex credential'],
      ['custom', 'Credential'],
    ] as const) {
      await openFormFor(page, platformId);

      await expect(page.getByLabel(label)).toHaveAttribute('type', 'password');
      await expect(page.getByPlaceholder('Paste the value')).toHaveCount(1);
    }
  });
});

test.describe('validation refuses a key of the wrong shape', () => {
  test('rejects a malformed OpenAI key and stores nothing', async ({ page }) => {
    await openFormFor(page, 'openai');
    await page.getByLabel('Name').fill('Bad OpenAI');
    await page.getByLabel('OpenAI key').fill('hello');
    await page.getByRole('button', { name: 'Save key' }).click();

    await expect(page.getByText(/does not look like a valid OpenAI key/)).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Bad OpenAI' })).toHaveCount(0);
  });

  test('rejects an OpenAI key pasted into the Anthropic slot', async ({ page }) => {
    await openFormFor(page, 'anthropic');
    await page.getByLabel('Name').fill('Wrong slot');
    await page.getByLabel('Anthropic key').fill(KEYS.openai);
    await page.getByRole('button', { name: 'Save key' }).click();

    await expect(page.getByText(/does not look like a valid Anthropic key/)).toBeVisible();
  });

  test('rejects a too-short Azure key', async ({ page }) => {
    await openFormFor(page, 'azure-openai');
    await page.getByLabel('Name').fill('Short azure');
    await page.getByLabel('Azure OpenAI key').fill('a'.repeat(31));
    await page.getByRole('button', { name: 'Save key' }).click();

    await expect(page.getByText(/does not look like a valid Azure OpenAI key/)).toBeVisible();
  });

  test('names the offending half of an AWS pair', async ({ page }) => {
    await openFormFor(page, 'aws');
    await page.getByLabel('Name').fill('Bad AWS');
    await page.getByLabel('Access key ID').fill('not-an-aws-key-id');
    await page.getByLabel('Secret access key').fill(KEYS.awsSecret);
    await page.getByRole('button', { name: 'Save key' }).click();

    await expect(page.getByText(/does not look like a valid Access key ID/)).toBeVisible();
  });

  test('never echoes the pasted secret back in the error', async ({ page }) => {
    await openFormFor(page, 'azure-openai');
    await page.getByLabel('Name').fill('Echo check');
    await page.getByLabel('Azure OpenAI key').fill('sk-ant-super-secret-value');
    await page.getByRole('button', { name: 'Save key' }).click();

    await expect(page.getByText(/does not look like a valid Azure OpenAI key/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('sk-ant-super-secret-value');
  });

  test('accepts anything for the custom platform', async ({ page }) => {
    await openFormFor(page, 'custom');
    await page.getByLabel('Name').fill('Some vendor');
    await page.getByLabel('Credential').fill(KEYS.custom);
    await page.getByRole('button', { name: 'Save key' }).click();

    await expect(page.getByRole('cell', { name: 'Some vendor' })).toBeVisible();
  });
});

test.describe('a saved key is masked, dated and one-per-platform', () => {
  test('shows the masked tail and no expiry of ours', async ({ page }) => {
    await openFormFor(page, 'openai');
    await page.getByLabel('Name').fill('Acme OpenAI');
    await page.getByLabel('OpenAI key').fill(KEYS.openai);
    await page.getByRole('button', { name: 'Save key' }).click();

    const row = page.getByRole('row', { name: /Acme OpenAI/ });

    await expect(row).toContainText('OpenAI');
    await expect(row).toContainText('…1234');
    await expect(row).toContainText('Active');
    // "—", not "Never": the vendor can still expire the key on us.
    await expect(row).toContainText('—');
    await expect(page.locator('body')).not.toContainText(KEYS.openai);
  });

  test('is still unreadable after a reload', async ({ page }) => {
    await page.reload();

    await expect(page.getByRole('cell', { name: 'Acme OpenAI' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(KEYS.openai);
  });

  test('warns that saving another OpenAI key replaces the one on file', async ({ page }) => {
    await openFormFor(page, 'openai');

    await expect(page.getByText(/already has/)).toBeVisible();
    await expect(page.getByText(/Saving replaces it/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replace key' })).toBeVisible();
  });

  test('replacing revokes the old key and keeps exactly one live', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());

    await openFormFor(page, 'openai');
    await page.getByLabel('Name').fill('Acme OpenAI rotated');
    await page.getByLabel('OpenAI key').fill(KEYS.openaiReplacement);
    await page.getByRole('button', { name: 'Replace key' }).click();

    await expect(page.getByRole('row', { name: /Acme OpenAI rotated/ })).toContainText('…9999');
    await expect(page.getByRole('row', { name: /Acme OpenAI rotated/ })).toContainText('Active');
    await expect(page.getByRole('row', { name: /Acme OpenAI(?! rotated)/ })).toContainText('Revoked');
  });

  test('a different platform keeps its own live key', async ({ page }) => {
    await openFormFor(page, 'anthropic');
    await page.getByLabel('Name').fill('Acme Anthropic');
    await page.getByLabel('Anthropic key').fill(KEYS.anthropic);
    await page.getByRole('button', { name: 'Save key' }).click();

    await expect(page.getByRole('row', { name: /Acme Anthropic/ })).toContainText('Active');
    await expect(page.getByRole('row', { name: /Acme OpenAI rotated/ })).toContainText('Active');
  });

  test('stores an AWS pair and hints at the secret half', async ({ page }) => {
    await openFormFor(page, 'aws');
    await page.getByLabel('Name').fill('Acme AWS');
    await page.getByLabel('Access key ID').fill(KEYS.awsAccessKeyId);
    await page.getByLabel('Secret access key').fill(KEYS.awsSecret);
    await page.getByRole('button', { name: 'Save key' }).click();

    const row = page.getByRole('row', { name: /Acme AWS/ });

    await expect(row).toContainText('…EKEY');
    await expect(page.locator('body')).not.toContainText(KEYS.awsSecret);
  });
});

test.describe('the Vocion token keeps its own rules', () => {
  test('is shown once and only once, with a real expiry', async ({ page }) => {
    await openFormFor(page, 'vocion');
    await page.getByLabel('Name').fill('Integration token');
    await page.getByLabel('Expires').selectOption('90');
    await page.getByRole('button', { name: 'Create token' }).click();

    await expect(page.getByText(/created/)).toBeVisible();

    const secret = (await page.locator('code').first().textContent()) ?? '';

    expect(secret).toMatch(/^vcn_live_/);

    const row = page.getByRole('row', { name: /Integration token/ });

    await expect(row).toContainText('Vocion');
    await expect(row).toContainText('Vocion-issued');
    // A real date, not the em dash the platform keys show.
    await expect(row).not.toContainText('—');

    await page.reload();

    await expect(page.locator('body')).not.toContainText(secret);
  });

  test('allows a second live Vocion token, unlike a platform key', async ({ page }) => {
    await openFormFor(page, 'vocion');
    await page.getByLabel('Name').fill('Second token');
    await page.getByLabel('Expires').selectOption('never');
    await page.getByRole('button', { name: 'Create token' }).click();

    await expect(page.getByRole('row', { name: /Second token/ })).toContainText('Never');
    await expect(page.getByRole('row', { name: /Integration token/ })).toContainText('Active');
    await expect(page.getByRole('row', { name: /Second token/ })).toContainText('Active');
  });

  test('refuses an expiry in the past, at the picker', async ({ page }) => {
    await openFormFor(page, 'vocion');
    await page.getByLabel('Name').fill('Backdated');
    await page.getByLabel('Expires').selectOption('custom');

    const dateField = page.getByLabel('Custom expiry date');
    const today = new Date();
    const isoToday = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`;

    await expect(dateField).toHaveAttribute('min', isoToday);

    await dateField.fill('2020-01-01');
    await page.getByRole('button', { name: 'Create token' }).click();

    // The browser's own `min` validation stops the submit before the app's
    // guard in selectedExpiry or the router's readExpiry ever runs, so the
    // refusal is a native bubble rather than the app's message. All three
    // exist deliberately; this asserts the outermost one, and the router test
    // covers the server-side guard for a caller that skips the form.
    expect(await dateField.evaluate(node => (node as HTMLInputElement).checkValidity())).toBe(false);
    expect(await dateField.evaluate(node => (node as HTMLInputElement).validationMessage)).not.toBe('');
    await expect(page.getByRole('cell', { name: 'Backdated' })).toHaveCount(0);
  });

  test('caps the custom expiry at ten years out', async ({ page }) => {
    await openFormFor(page, 'vocion');
    await page.getByLabel('Expires').selectOption('custom');

    const dateField = page.getByLabel('Custom expiry date');
    const cap = new Date();
    cap.setFullYear(cap.getFullYear() + 10);
    const isoCap = `${cap.getFullYear()}-${`${cap.getMonth() + 1}`.padStart(2, '0')}-${`${cap.getDate()}`.padStart(2, '0')}`;

    await expect(dateField).toHaveAttribute('max', isoCap);
  });

  test('revoking says the platform key falls back, not that things break', async ({ page }) => {
    const messages: string[] = [];
    page.on('dialog', (dialog) => {
      messages.push(dialog.message());
      return dialog.dismiss();
    });

    await page.getByRole('row', { name: /Acme Anthropic/ }).getByRole('button', { name: 'Revoke' }).click();
    await page.getByRole('row', { name: /Second token/ }).getByRole('button', { name: 'Revoke' }).click();

    expect(messages[0]).toContain('Vocion server key');
    expect(messages[1]).toContain('stops working immediately');
  });
});
