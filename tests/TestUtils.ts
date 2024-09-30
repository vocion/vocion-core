import assert from 'node:assert';

import { clerkClient } from '@clerk/nextjs/server';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';
import { faker } from '@faker-js/faker';
import { expect, type Page } from '@playwright/test';

export const createUserWithOrganization = async (page: Page) => {
  await setupClerkTestingToken({ page });

  await page.goto('/sign-up');

  const email = faker.internet.email();
  // Any email with the +clerk_test subaddress is a test email address
  process.env.E2E_CLERK_USER_USERNAME = `${email.split('@')[0]}+clerk_test@${email.split('@')[1]}`;
  process.env.E2E_CLERK_USER_PASSWORD = 'password+clerk_test';

  await page.getByLabel('Email address').fill(process.env.E2E_CLERK_USER_USERNAME);
  await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_CLERK_USER_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Verify your email')).toBeVisible();

  // Need to wait for the email verification code to be 'sent' (simulated in the test environment)
  await expect(async () => {
    // The verification code for test emails is `424242`
    await page.getByLabel('Enter verification code').fill('424242');

    await expect(page.getByRole('heading', { name: 'Create Organization' })).toBeVisible();
  }).toPass();

  await page.getByLabel('Name').fill(faker.company.name());
  await page.getByRole('button', { name: 'Create Organization' }).click();

  await expect(page.getByText('Welcome to your dashboard')).toBeVisible();
};

export const deleteUserWithOrganization = async () => {
  assert(process.env.E2E_CLERK_USER_USERNAME, 'E2E_CLERK_USER_USERNAME is not set');

  const { data } = await clerkClient().users.getUserList({
    emailAddress: [process.env.E2E_CLERK_USER_USERNAME],
  });

  assert(data[0] !== undefined, 'User not found');

  const { data: orgMemList } = await clerkClient().users.getOrganizationMembershipList({
    userId: data[0].id,
  });

  for (const orgMem of orgMemList) {
    await clerkClient().organizations.deleteOrganization(orgMem.organization.id);
  }

  await clerkClient().users.deleteUser(data[0].id);
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
};

export const createOrganization = async (page: Page) => {
  await page.getByLabel('Open organization switcher').click();
  await page.getByRole('menuitem', { name: 'Create organization' }).click();

  const companyName = faker.company.name();
  await page.getByLabel('Name').fill(companyName);
  await page.getByRole('button', { name: 'Create organization' }).click();

  await expect(page.getByText(companyName)).toBeVisible();
};
