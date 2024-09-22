import { clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright';
import { faker } from '@faker-js/faker';
import { expect, test as setup } from '@playwright/test';

import { AUTH_FILE } from './TestUtils';

setup('account and organization creation', async ({ page }) => {
  await clerkSetup();
  await setupClerkTestingToken({ page });

  await page.goto('/sign-up');

  await expect(page.getByText('Email address')).toBeVisible();

  const email = faker.internet.email();
  // Any email with the +clerk_test subaddress is a test email address
  process.env.E2E_CLERK_USER_USERNAME = `${email.split('@')[0]}+clerk_test@${email.split('@')[1]}`;
  const password = 'password+clerk_test';

  await page.getByLabel('Email address').fill(process.env.E2E_CLERK_USER_USERNAME);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Verify your email')).toBeVisible();

  // The verification code for test emails is `424242`
  await page.getByLabel('Enter verification code').fill('424242');

  await expect(page.getByRole('heading', { name: 'Create Organization' })).toBeVisible();

  await page.getByLabel('Name').fill(faker.company.name());
  await page.getByRole('button', { name: 'Create Organization' }).click();

  await expect(page.getByText('Welcome to your dashboard')).toBeVisible();

  await page.context().storageState({ path: AUTH_FILE });
});
