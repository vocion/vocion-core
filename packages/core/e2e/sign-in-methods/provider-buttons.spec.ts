import { expect, test } from '@playwright/test';

/**
 * "Continue with Google" / "Continue with Microsoft" appear exactly when the
 * server has the provider's client id and secret. The Playwright server is
 * started with placeholder values for both (`playwright.config.ts`), so both
 * buttons must be on the sign-in page and the invite page, and Auth.js must
 * list both providers. Nothing here calls Google or Microsoft.
 *
 * Run with: npx playwright test --project=sign-in-methods
 */

test('the sign-in page offers each configured provider above the email form', async ({ page }) => {
  await page.goto('/sign-in');

  const google = page.getByRole('button', { name: 'Continue with Google' });
  const microsoft = page.getByRole('button', { name: 'Continue with Microsoft' });

  await expect(google).toBeVisible();
  await expect(microsoft).toBeVisible();

  // Above the email field, not below it.
  const googleBox = await google.boundingBox();
  const emailBox = await page.getByLabel('Email').boundingBox();

  expect(googleBox!.y).toBeLessThan(emailBox!.y);

  // The password is still there (the e2e server has no outbound mail, so the
  // field asks for it rather than leading with the email link), and sign-up
  // still is not.
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByText('This instance is invite-only')).toBeVisible();
});

test('the invite page offers the same buttons', async ({ page }) => {
  await page.goto('/sign-up?invite=e2e-placeholder-invite');

  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Microsoft' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept invite + sign in' })).toBeVisible();
});

test('a refused provider sign-in comes back with a sentence, not an error page', async ({ page }) => {
  await page.goto('/sign-in?error=AccessDenied&reason=no-invite&provider=google');

  // Filtered by text: Next.js's route announcer is an (empty) alert too.
  await expect(page.getByRole('alert').filter({ hasText: 'No invite for this address' })).toHaveText('No invite for this address. Ask an admin to invite you.');
});

test('Auth.js registers exactly the configured providers', async ({ request }) => {
  const res = await request.get('/api/auth/providers');

  expect(res.ok()).toBe(true);

  const providers = await res.json() as Record<string, { id: string; callbackUrl: string }>;

  // `email` too when the server has outbound mail set up.
  expect(Object.keys(providers).filter(id => id !== 'email').sort()).toEqual(['credentials', 'google', 'microsoft-entra-id']);
  expect(new URL(providers.google!.callbackUrl).pathname).toBe('/api/auth/callback/google');
  expect(new URL(providers['microsoft-entra-id']!.callbackUrl).pathname).toBe('/api/auth/callback/microsoft-entra-id');
});
