import type { Page } from '@playwright/test';
import assert from 'node:assert';
import { clerkClient } from '@clerk/nextjs/server';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';
import { faker } from '@faker-js/faker';
import { expect } from '@playwright/test';

export const createUserWithOrganization = async (page: Page) => {
  await setupClerkTestingToken({ page });

  await page.goto('/sign-up');

  const email = faker.internet.email();
  // Any email with the +clerk_test subaddress is a test email address
  process.env.E2E_CLERK_USER_USERNAME = `${email.split('@')[0]}+clerk_test@${email.split('@')[1]}`;
  process.env.E2E_CLERK_USER_PASSWORD = 'password+clerk_test';

  // Wait for the email to be "sent" to avoid the error: "You need to send a verification code before attempting to verify."
  const prepareVerification = page.waitForResponse(res => res.url().includes('prepare_verification') && res.status() === 200);

  await page.getByLabel('Email address').fill(process.env.E2E_CLERK_USER_USERNAME);
  await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_CLERK_USER_PASSWORD);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(page.getByText('Verify your email')).toBeVisible();

  await prepareVerification;

  // The verification code for test emails is `424242`
  await page.getByLabel('Enter verification code').fill('424242');

  await expect(page.getByRole('heading', { name: 'Create Organization' })).toBeVisible();

  await page.getByLabel('Name').fill(faker.company.name());
  await page.getByRole('button', { name: 'Create Organization' }).click();

  await expect(page.getByText('Main navigation')).toBeVisible();
};

export const deleteUserWithOrganization = async () => {
  assert(process.env.E2E_CLERK_USER_USERNAME, 'E2E_CLERK_USER_USERNAME is not set');

  const authClient = await clerkClient();
  const { data } = await authClient.users.getUserList({
    emailAddress: [process.env.E2E_CLERK_USER_USERNAME],
  });

  assert(data[0] !== undefined, 'User not found');

  const { data: orgMemList } = await authClient.users.getOrganizationMembershipList({
    userId: data[0].id,
  });

  for (const orgMem of orgMemList) {
    await authClient.organizations.deleteOrganization(orgMem.organization.id);
  }

  await authClient.users.deleteUser(data[0].id);
};

export const signIn = async (page: Page) => {
  assert(process.env.E2E_CLERK_USER_USERNAME, 'E2E_CLERK_USER_USERNAME is not set');
  assert(process.env.E2E_CLERK_USER_PASSWORD, 'E2E_CLERK_USER_PASSWORD is not set');

  await page.goto('/sign-up');
  await clerk.signIn({
    page,
    signInParams: {
      strategy: 'password',
      identifier: process.env.E2E_CLERK_USER_USERNAME,
      password: process.env.E2E_CLERK_USER_PASSWORD,
    },
  });
  await page.goto('/dashboard');
};

export const createOrganization = async (page: Page) => {
  await page.getByLabel('Open organization switcher').click();
  await page.getByRole('menuitem', { name: 'Create organization' }).click();

  const companyName = faker.company.name();
  await page.getByLabel('Name').fill(companyName);
  await page.getByRole('button', { name: 'Create organization' }).click();

  await expect(page.getByText('Choose an organization')).toBeVisible();

  await page.getByText(companyName).click();

  await expect(page.getByLabel('Open organization switcher').getByText(companyName)).toBeVisible();
};
